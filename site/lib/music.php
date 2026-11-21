<?php
/* ============================================================
   情侣网站 · 背景音乐库
   ------------------------------------------------------------
   文件放 assets/music/，索引放 data/music.json：
     { "active": "<track id>|''", "tracks": [ {id,file,title,size,ts}, ... ] }
   - 一首可设为「当前」，前端优先播放它
   - 没有设置时，前端回落到 assets/music/music.dat（历史手工曲目），
     再没有就用内置 WebAudio 合成旋律（零文件依赖）
   - 所有写操作走 love_mutate()，与其它数据文件共用同一把锁

   为什么音频直接放 assets/music/ 而不做代理：
   音乐不含隐私（照片才需要 photo.php 门禁），且浏览器对音频要支持 Range 请求，
   走 PHP 代理既费 CPU 又容易断流。文件名带随机串，不可被猜到枚举。
   ============================================================ */

require_once __DIR__ . '/store.php';

const LOVE_MUSIC_SUBDIR   = 'assets/music';
const LOVE_MUSIC_INDEX    = 'music.json';
const LOVE_MUSIC_MAX_BYTES = 12582912;   // 12 MiB（base64 后约 16MB，Nginx 上限 20m）
const LOVE_MUSIC_MAX_TRACKS = 30;

/** 允许的扩展名 → 用于展示的 MIME（仅作白名单，不做转码） */
function love_music_exts(): array {
    return ['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac'];
}

function love_music_dir(): string {
    return dirname(__DIR__) . '/' . LOVE_MUSIC_SUBDIR;
}

/** 文件名安全校验：只允许 music-<随机>.<ext> 这种形态 */
function love_music_file_ok(string $file): bool {
    if ($file === '' || strpos($file, '/') !== false || strpos($file, '\\') !== false) return false;
    if ($file[0] === '.') return false;
    return (bool)preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/', $file);
}

function love_music_title_clean(string $t): string {
    $t = trim(preg_replace('/\s+/u', ' ', $t));
    if ($t === '') return '未命名';
    if (function_exists('mb_substr')) return mb_substr($t, 0, 60, 'UTF-8');
    return substr($t, 0, 60);
}

/**
 * 读取索引，并丢弃「记录还在、文件已丢」的条目。
 * 返回 ['active' => string, 'tracks' => array]
 */
function love_music_all(): array {
    $d = love_read(LOVE_MUSIC_INDEX, []);
    if (!is_array($d)) $d = [];
    $dir = love_music_dir();
    $tracks = [];
    foreach ((array)($d['tracks'] ?? []) as $t) {
        if (!is_array($t)) continue;
        $file = u_str($t['file'] ?? '');
        if (!love_music_file_ok($file)) continue;
        if (!is_file($dir . '/' . $file)) continue;     // 文件被手工删了 → 不再列出
        $id = u_str($t['id'] ?? '');
        if ($id === '') $id = pathinfo($file, PATHINFO_FILENAME);
        $tracks[] = [
            'id'    => $id,
            'file'  => $file,
            'title' => love_music_title_clean(u_str($t['title'] ?? '')),
            'size'  => (int)($t['size'] ?? @filesize($dir . '/' . $file)),
            'ts'    => (int)($t['ts'] ?? 0),
        ];
    }
    usort($tracks, function ($a, $b) { return $b['ts'] <=> $a['ts']; });

    $active = u_str($d['active'] ?? '');
    $ids = array_column($tracks, 'id');
    if ($active === '' || !in_array($active, $ids, true)) $active = '';

    return ['active' => $active, 'tracks' => $tracks];
}

/** 后台列表用：附带限制信息 */
function love_music_admin_view(): array {
    $a = love_music_all();
    return $a + [
        'max'   => LOVE_MUSIC_MAX_BYTES,
        'exts'  => love_music_exts(),
        'limit' => LOVE_MUSIC_MAX_TRACKS,
        'dir'   => LOVE_MUSIC_SUBDIR,
        'writable' => is_dir(love_music_dir()) && is_writable(love_music_dir()),
    ];
}

/**
 * 前台注入用：整份曲目列表 + 当前曲目。
 * 为什么现在要下发列表：前台变成了真正的播放器（上一首/下一首/列表/随机），
 * 只有一个"当前曲目"不够用。这里只有标题、大小和播放地址 —— 音频文件本身
 * 一直是公开可取的（文件名带随机串），曲目名也不含隐私；整段注入仍然只在解锁后下发。
 */
function love_music_view(): array {
    $a = love_music_all();
    $out = ['active' => null, 'total' => count($a['tracks']), 'tracks' => []];
    foreach ($a['tracks'] as $t) {
        $item = [
            'id'    => $t['id'],
            'title' => $t['title'],
            'url'   => LOVE_MUSIC_SUBDIR . '/' . rawurlencode($t['file']) . '?v=' . ($t['ts'] ?: $t['size']),
            'size'  => (int)$t['size'],
            'ts'    => (int)$t['ts'],
        ];
        $out['tracks'][] = $item;
        if ($t['id'] === $a['active']) $out['active'] = $item;
    }
    return $out;
}

/**
 * 上传一首：$b64 可带 data:audio/...;base64, 前缀
 * 返回 ['ok'=>bool, 'error'=>?, 'track'=>?, 'active'=>?]
 */
function love_music_add(string $filename, string $b64): array {
    $dir = love_music_dir();
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0755, true)) return ['ok' => false, 'error' => '无法创建音乐目录 ' . LOVE_MUSIC_SUBDIR];
    }
    if (!is_writable($dir)) return ['ok' => false, 'error' => '音乐目录不可写，请检查 ' . LOVE_MUSIC_SUBDIR . ' 的权限'];

    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if (!in_array($ext, love_music_exts(), true)) {
        return ['ok' => false, 'error' => '不支持的格式（支持：' . implode(' / ', love_music_exts()) . '）'];
    }

    /* dataURL 前缀：只取逗号之后的部分 */
    if (strpos($b64, ',') !== false) $b64 = substr($b64, strpos($b64, ',') + 1);
    $b64 = preg_replace('/\s+/', '', $b64);
    if ($b64 === '') return ['ok' => false, 'error' => '没有收到文件内容'];

    /* 先按长度粗判，避免把 20MB 的串解码进内存 */
    if (strlen($b64) > (int)ceil(LOVE_MUSIC_MAX_BYTES * 4 / 3) + 1024) {
        return ['ok' => false, 'error' => '文件太大（上限 ' . round(LOVE_MUSIC_MAX_BYTES / 1048576, 1) . ' MB）'];
    }
    $bin = base64_decode($b64, true);
    if ($bin === false) return ['ok' => false, 'error' => '文件内容不是合法的 base64'];
    $size = strlen($bin);
    if ($size === 0) return ['ok' => false, 'error' => '文件是空的'];
    if ($size > LOVE_MUSIC_MAX_BYTES) {
        return ['ok' => false, 'error' => '文件太大（上限 ' . round(LOVE_MUSIC_MAX_BYTES / 1048576, 1) . ' MB）'];
    }

    /* 内容嗅探：挡住了「改名成 .mp3 的可执行文件」
       有些运行环境没有 fileinfo 扩展，此时跳过（已在 Nginx 侧禁止执行上传目录） */
    if (class_exists('finfo')) {
        $fi = new finfo(FILEINFO_MIME_TYPE);
        $mime = (string)$fi->buffer($bin);
        $okMime = [
            'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
            'audio/ogg', 'audio/opus', 'audio/wav', 'audio/x-wav', 'audio/flac',
            'audio/x-flac', 'application/ogg', 'video/mp4', 'application/octet-stream',
        ];
        if ($mime !== '' && !in_array($mime, $okMime, true)) {
            return ['ok' => false, 'error' => '这个文件看起来不是音频（识别为 ' . $mime . '）'];
        }
    }

    $cur = love_music_all();
    if (count($cur['tracks']) >= LOVE_MUSIC_MAX_TRACKS) {
        return ['ok' => false, 'error' => '最多保存 ' . LOVE_MUSIC_MAX_TRACKS . ' 首，请先删除一些'];
    }

    $id   = 'm' . time() . bin2hex(random_bytes(4));
    $file = $id . '.' . $ext;
    $abs  = $dir . '/' . $file;

    if (@file_put_contents($abs, $bin) !== $size) {
        @unlink($abs);
        return ['ok' => false, 'error' => '写入文件失败（磁盘满或权限不足）'];
    }
    @chmod($abs, 0644);

    $title = love_music_title_clean(pathinfo($filename, PATHINFO_FILENAME));
    $rec = ['id' => $id, 'file' => $file, 'title' => $title, 'size' => $size, 'ts' => time()];

    $saved = love_mutate(LOVE_MUSIC_INDEX, function ($data) use ($rec) {
        $data = is_array($data) ? $data : [];
        $tracks = is_array($data['tracks'] ?? null) ? $data['tracks'] : [];
        $tracks[] = $rec;
        $data['tracks'] = $tracks;
        if (empty($data['active']) && is_string($data['active'] ?? '')) $data['active'] = $rec['id'];
        if (!isset($data['active'])) $data['active'] = $rec['id'];
        return $data;
    }, []);

    if (!is_array($saved)) {
        @unlink($abs);
        return ['ok' => false, 'error' => '索引写入失败（data/ 不可写？）'];
    }

    return ['ok' => true, 'track' => $rec] + love_music_admin_view();
}

/** 编辑标题 */
function love_music_update(string $id, string $title): array {
    if ($id === '') return ['ok' => false, 'error' => '缺少曲目 id'];
    $title = love_music_title_clean($title);
    $found = false;
    $out = love_mutate(LOVE_MUSIC_INDEX, function ($data) use ($id, $title, &$found) {
        $data = is_array($data) ? $data : [];
        $tracks = is_array($data['tracks'] ?? null) ? $data['tracks'] : [];
        foreach ($tracks as $i => $t) {
            if (is_array($t) && u_str($t['id'] ?? '') === $id) {
                $tracks[$i]['title'] = $title;
                $found = true;
                break;
            }
        }
        $data['tracks'] = $tracks;
        return $data;
    }, []);
    if (!is_array($out)) return ['ok' => false, 'error' => '保存失败（data/ 不可写？）'];
    if (!$found) return ['ok' => false, 'error' => '没找到这首音乐'];
    return ['ok' => true, 'title' => $title] + love_music_admin_view();
}

/** 设为当前曲目；$id 为空 = 取消（回落到内置/历史曲目） */
function love_music_activate(string $id): array {
    $all = love_music_all();
    if ($id !== '' && !in_array($id, array_column($all['tracks'], 'id'), true)) {
        return ['ok' => false, 'error' => '没找到这首音乐'];
    }
    $out = love_mutate(LOVE_MUSIC_INDEX, function ($data) use ($id) {
        $data = is_array($data) ? $data : [];
        $data['active'] = $id;
        return $data;
    }, []);
    if (!is_array($out)) return ['ok' => false, 'error' => '保存失败（data/ 不可写？）'];
    return ['ok' => true, 'active' => $id] + love_music_admin_view();
}

/** 删除：先摘记录，再删文件（文件删不掉不阻塞记录移除，避免"幽灵条目"） */
function love_music_delete(string $id): array {
    if ($id === '') return ['ok' => false, 'error' => '缺少曲目 id'];
    $file = '';
    $out = love_mutate(LOVE_MUSIC_INDEX, function ($data) use ($id, &$file) {
        $data = is_array($data) ? $data : [];
        $tracks = is_array($data['tracks'] ?? null) ? $data['tracks'] : [];
        $keep = [];
        foreach ($tracks as $t) {
            if (is_array($t) && u_str($t['id'] ?? '') === $id) {
                $file = u_str($t['file'] ?? '');
                continue;
            }
            $keep[] = $t;
        }
        $data['tracks'] = $keep;
        if (u_str($data['active'] ?? '') === $id) $data['active'] = '';
        return $data;
    }, []);
    if (!is_array($out)) return ['ok' => false, 'error' => '保存失败（data/ 不可写？）'];
    if ($file !== '' && love_music_file_ok($file)) {
        $abs = love_music_dir() . '/' . $file;
        if (is_file($abs)) @unlink($abs);
    }
    return ['ok' => true] + love_music_admin_view();
}
