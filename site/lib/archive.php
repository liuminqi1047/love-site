<?php
/* ============================================================
   便携备份包（love-backup）
   ------------------------------------------------------------
   目标：**换一台服务器重新部署后，只要上传这一个文件，数据和状态就回来了。**

   包内布局（zip，store 方式，见 lib/zip.php）：
     manifest.json          格式版本 / 站点名 / 条目数量 / 每个文件的 sha256
     data/*.json            全部运行时数据（配置、内容、每日一问、默契、心愿、
                            身份、音乐索引、管理员）
     photos/<文件名>        上传的照片原图
     music/<文件名>         背景音乐

   不包含：data/security.json（限流计数，恢复它等于让暴力破解重新计时）、
           data/gate_secret（门禁签名密钥，外带即可伪造解锁 Cookie，新站重新生成）、
           data/thumbs（缩略图缓存，按需重建）。

   为什么不做成「JSON 备份」的超集：旧接口只认结构化对象，恢复时逐字段清洗，
   新加的数据文件（identity/wishes/music）根本不在那个对象里 —— 换主机后
   身份归属、心愿状态、当前曲目都会丢。这里按文件整体恢复，语义是"回到那一刻"。
   ============================================================ */

require_once __DIR__ . '/zip.php';

/** 站点版本号（site/VERSION，缺失时退回 0.0.0）。 */
function love_app_version(string $root): string {
    $v = @file_get_contents($root . '/VERSION');
    $v = is_string($v) ? trim($v) : '';
    return preg_match('/^[0-9A-Za-z._-]{1,20}$/', $v) ? $v : '0.0.0';
}

/** 按站点目录收集要打包的条目：[归档内路径 => 绝对路径]。 */
function love_archive_collect(string $root, bool $withMusic = true): array {
    $entries = [];

    foreach (glob($root . '/data/*.json') ?: [] as $p) {
        $base = basename($p);
        if ($base === 'security.json') continue;   // 锁定计数不外带
        if (is_file($p)) $entries['data/' . $base] = $p;
    }

    foreach (glob($root . '/assets/img/uploads/*') ?: [] as $p) {
        $base = basename($p);
        if ($base === '' || $base[0] === '.' || !is_file($p)) continue;
        $entries['photos/' . $base] = $p;
    }

    if ($withMusic) {
        foreach (glob($root . '/assets/music/*') ?: [] as $p) {
            $base = basename($p);
            if ($base === '' || $base[0] === '.' || !is_file($p)) continue;
            $entries['music/' . $base] = $p;
        }
    }

    ksort($entries);
    return $entries;
}

/** 生成 manifest（含每个文件的 sha256，恢复时逐条比对）。 */
function love_archive_manifest(string $root, array $entries, bool $withMusic): array {
    $files = [];
    foreach ($entries as $name => $path) {
        $files[] = [
            'path'   => $name,
            'size'   => (int)@filesize($path),
            'sha256' => (string)@hash_file('sha256', $path),
        ];
    }
    $cnt = ['data' => 0, 'photos' => 0, 'music' => 0];
    foreach ($files as $f) {
        $p = strtok($f['path'], '/');
        if (isset($cnt[$p])) $cnt[$p]++;
    }

    $cfg = love_read('config.json', []);
    $names = is_array($cfg['names'] ?? null) ? $cfg['names'] : [];
    return [
        'format'        => 'love-backup',
        'formatVersion' => 1,
        'appVersion'    => love_app_version($root),
        'createdAt'     => date('c'),
        'withMusic'     => $withMusic,
        'site'          => [
            'names'     => ['boy' => (string)($names['boy'] ?? ''), 'girl' => (string)($names['girl'] ?? '')],
            'startDate' => (string)($cfg['startDate'] ?? ''),
        ],
        'counts'        => $cnt,
        'files'         => $files,
        'note'          => '不包含 security.json / gate_secret / thumbs；恢复后门禁密钥会重新生成。',
    ];
}

/** 打包到文件。成功返回 manifest，失败返回 null。 */
function love_archive_build(string $root, string $outPath, bool $withMusic = true): ?array {
    $entries = love_archive_collect($root, $withMusic);
    if ($entries === []) return null;
    $manifest = love_archive_manifest($root, $entries, $withMusic);

    $payload = ['manifest.json' => json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)] + $entries;
    if (!love_zip_write_file($payload, $outPath)) return null;
    return $manifest;
}

/**
 * 校验备份包：结构、清单、每个文件的存在性与 sha256。
 * 返回 ['ok'=>bool, 'manifest'=>array, 'index'=>array, 'errors'=>string[], 'warnings'=>string[]]
 */
function love_archive_verify(string $zipPath): array {
    $out = ['ok' => false, 'manifest' => null, 'index' => [], 'errors' => [], 'warnings' => []];

    $index = love_zip_index($zipPath);
    if ($index === []) { $out['errors'][] = '不是有效的 ZIP 包（找不到中央目录）'; return $out; }
    $out['index'] = $index;

    if (!isset($index['manifest.json'])) { $out['errors'][] = '包里没有 manifest.json，不是本站的备份包'; return $out; }
    $raw = love_zip_entry($zipPath, $index['manifest.json']);
    if ($raw === null) { $out['errors'][] = 'manifest.json 读取失败（CRC 不符或已损坏）'; return $out; }
    $m = json_decode($raw, true);
    if (!is_array($m) || ($m['format'] ?? '') !== 'love-backup') {
        $out['errors'][] = 'manifest.json 格式不对（不是 love-backup 包）';
        return $out;
    }
    $out['manifest'] = $m;
    if ((int)($m['formatVersion'] ?? 0) !== 1) {
        $out['errors'][] = '备份包格式版本不支持：' . (string)($m['formatVersion'] ?? '?');
        return $out;
    }

    $seen = [];
    foreach ((array)($m['files'] ?? []) as $rec) {
        if (!is_array($rec)) { $out['errors'][] = '清单里有非法条目'; continue; }
        $path = (string)($rec['path'] ?? '');
        if (!love_archive_path_ok($path)) { $out['errors'][] = '清单里有非法路径：' . $path; continue; }
        if (!isset($index[$path])) { $out['errors'][] = '包里缺少文件：' . $path; continue; }
        $seen[$path] = true;
        $data = love_zip_entry($zipPath, $index[$path]);
        if ($data === null) { $out['errors'][] = '文件损坏：' . $path; continue; }
        if (isset($rec['sha256']) && hash('sha256', $data) !== (string)$rec['sha256']) {
            $out['errors'][] = '校验和不符：' . $path;
        }
    }
    foreach (array_keys($index) as $path) {
        if ($path === 'manifest.json') continue;
        if (!isset($seen[$path])) $out['warnings'][] = '包里有清单之外的文件（已忽略）：' . $path;
    }

    $out['ok'] = $out['errors'] === [];
    return $out;
}

/** 归档内路径是否可安全落地：只允许 data/ photos/ music/ 三段，文件名不带路径分隔。 */
function love_archive_path_ok(string $path): bool {
    if ($path === '' || strpos($path, "\0") !== false) return false;
    if (strpos($path, '..') !== false || $path[0] === '/') return false;
    if (preg_match('#^(data|photos|music)/([^/\\\\]+)$#', $path, $m) !== 1) return false;
    $base = $m[2];
    if ($base === '' || $base === '.' || $base === '..' || $base[0] === '.') return false;
    if ($m[1] === 'data' && !preg_match('/^[a-z0-9_-]+\.json$/i', $base)) return false;
    return true;
}

/** 恢复前留一份现场（data/*.json 全量拷贝），返回目录或 null。 */
function love_archive_snapshot(string $root): ?string {
    $dir = $root . '/data/pre-restore/' . date('Ymd-His');
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) return null;
    $n = 0;
    foreach (glob($root . '/data/*.json') ?: [] as $p) {
        if (@copy($p, $dir . '/' . basename($p))) $n++;
    }
    @file_put_contents($dir . '/README.txt',
        "恢复前自动留存的现场（" . date('Y-m-d H:i:s') . "），共 {$n} 个 JSON。\n" .
        "要退回去：把这里的文件拷回 data/ 即可（权限 www-data 可写）。\n");
    return $n > 0 ? $dir : null;
}

/**
 * 把备份包落地到站点目录。
 * $writeJson 可选：data/*.json 交给调用方写入（后台走 admin_replace，与访客写操作共用 flock）。
 * 返回 ['data'=>n,'photos'=>n,'music'=>n,'removed'=>n,'errors'=>[],'warnings'=>[]]
 */
function love_archive_apply(string $zipPath, string $root, array $index, array $manifest, ?callable $writeJson = null): array {
    $rep = ['data' => 0, 'photos' => 0, 'music' => 0, 'removed' => 0, 'errors' => [], 'warnings' => []];

    $targets = [
        'data'   => $root . '/data',
        'photos' => $root . '/assets/img/uploads',
        'music'  => $root . '/assets/music',
    ];
    foreach ($targets as $kind => $dir) {
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
            $rep['errors'][] = "目录不可写：{$dir}";
            return $rep;
        }
    }

    $written = ['data' => [], 'photos' => [], 'music' => []];
    foreach ((array)($manifest['files'] ?? []) as $rec) {
        $path = (string)($rec['path'] ?? '');
        if (!love_archive_path_ok($path)) { $rep['warnings'][] = "跳过非法路径：{$path}"; continue; }
        if (!isset($index[$path])) continue;

        $data = love_zip_entry($zipPath, $index[$path]);
        if ($data === null) { $rep['errors'][] = "读取失败：{$path}"; continue; }

        [$kind, $base] = explode('/', $path, 2);
        if ($kind === 'data') {
            $obj = json_decode($data, true);
            if (!is_array($obj)) { $rep['errors'][] = "JSON 解析失败：{$path}"; continue; }
            if ($writeJson !== null) {
                if (!$writeJson($base, $obj)) { $rep['errors'][] = "写入失败：{$path}"; continue; }
                $written['data'][] = $base;
                $rep['data']++;
                continue;
            }
        }

        $dest = $targets[$kind] . '/' . $base;
        $tmp = $dest . '.tmp-' . bin2hex(random_bytes(4));
        if (@file_put_contents($tmp, $data) === false) { $rep['errors'][] = "写入失败：{$path}"; continue; }
        if (!@rename($tmp, $dest)) {
            @unlink($tmp);
            $rep['errors'][] = "落盘失败：{$path}";
            continue;
        }
        @chmod($dest, 0644);
        $written[$kind][] = $base;
        $rep[$kind]++;
    }

    /* 照片 / 音乐是"整组替换"：包里没有的旧文件要清掉，
       否则恢复完会多出后来上传、备份里根本没有的图（状态就不是"那一刻"了）。
       目录保护文件（.htaccess）与说明文件（说明.txt）保留。 */
    foreach (['photos' => 'assets/img/uploads', 'music' => 'assets/music'] as $kind => $rel) {
        $dir = $root . '/' . $rel;
        $keep = array_flip($written[$kind]);
        foreach (glob($dir . '/*') ?: [] as $p) {
            $base = basename($p);
            if (!is_file($p)) continue;
            if ($base !== '' && $base[0] === '.') continue;
            if ($base === '说明.txt') continue;
            if (isset($keep[$base])) continue;
            if (@unlink($p)) $rep['removed']++;
        }
    }

    /* 缩略图缓存按文件名索引，照片换了必须清掉，否则看到的是旧图 */
    foreach (glob($root . '/data/thumbs/*') ?: [] as $p) {
        if (is_file($p)) @unlink($p);
    }

    return $rep;
}
