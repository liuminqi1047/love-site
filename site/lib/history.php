<?php
/* ============================================================
   情侣网站 · 内容版本历史
   ------------------------------------------------------------
   每次写入 data/*.json 之前，把**旧内容**留一份到 data/history/<文件>/。
   目的：改错了能回到上一版，而不用整份恢复备份（那会把别的文件也一起
   带回旧状态）。

   几个刻意的取舍：
   1) 节流 60 秒。两个人边聊边发留言，一分钟能写好几条；每条都存一份
      版本，历史目录很快就成百上千个小文件。60 秒内只留最早的那一版，
      对"手滑改错"这件事足够用。
   2) 每文件最多 15 份 + 单份上限 2MB。免费主机磁盘有限，版本历史不能
      挤占照片与音乐的空间。
   3) 任何失败都静默。历史是"额外的保险"，绝不允许它让正常写入失败。
   4) 不记录 security.json —— 它存的是"失败次数/锁定到什么时候"，
      恢复一份旧快照等于把锁定状态拨回去，能让暴力破解多试几轮。

   本文件不 require store.php：它被 store.php 在写入路径里调用，
   反向依赖会形成循环。路径自己算，只用原生函数。
   ============================================================ */

declare(strict_types=1);

const HISTORY_KEEP         = 15;
const HISTORY_MIN_INTERVAL = 60;             // 秒
const HISTORY_MAX_BYTES    = 2 * 1024 * 1024;
const HISTORY_SKIP         = ['security.json'];

function history_root(): string {
    return dirname(__DIR__) . '/data/history';
}

/** 文件名只允许"一层"：拒绝 ../、子目录。 */
function history_file_ok(string $file): bool {
    if ($file === '' || in_array($file, HISTORY_SKIP, true)) return false;
    return preg_match('/^[A-Za-z0-9_.-]{1,64}$/', $file) === 1 && strpos($file, '..') === false;
}

function history_dir_for(string $file): string {
    return history_root() . '/' . preg_replace('/\.json$/', '', $file);
}

/** 记一份快照。$old 是写入前的原始文本（空串表示文件本来不存在/为空）。 */
function history_snapshot(string $file, string $old): void {
    if (!history_file_ok($file)) return;
    if ($old === '' || strlen($old) > HISTORY_MAX_BYTES) return;

    $dir = history_dir_for($file);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) return;

    /* 节流：看目录里最新一份的 mtime。用 mtime 而不是文件名排序，
       是因为文件名带随机后缀，排序结果与时间不完全一致。 */
    $newest = 0;
    $files = @scandir($dir);
    if (!is_array($files)) return;
    foreach ($files as $f) {
        if ($f === '.' || $f === '..') continue;
        $p = $dir . '/' . $f;
        $m = is_file($p) ? (int)@filemtime($p) : 0;
        if ($m > $newest) $newest = $m;
    }
    if ($newest > 0 && time() - $newest < HISTORY_MIN_INTERVAL) return;

    $name = date('Ymd-His') . '-' . substr(bin2hex(random_bytes(3)), 0, 6) . '.json';
    $path = $dir . '/' . $name;
    if (@file_put_contents($path, $old, LOCK_EX) === false) return;
    @chmod($path, 0644);

    /* 修剪：按 mtime 从旧到新删到只剩 HISTORY_KEEP 份。 */
    $all = [];
    foreach ((array)@scandir($dir) as $f) {
        if ($f === '.' || $f === '..') continue;
        $p = $dir . '/' . $f;
        if (is_file($p)) $all[] = ['p' => $p, 'm' => (int)@filemtime($p)];
    }
    if (count($all) <= HISTORY_KEEP) return;
    usort($all, function ($a, $b) { return $a['m'] <=> $b['m']; });
    $drop = count($all) - HISTORY_KEEP;
    for ($i = 0; $i < $drop; $i++) @unlink($all[$i]['p']);
}

/** 列出某文件的快照（新 → 旧）。 */
function history_list(string $file): array {
    if (!history_file_ok($file)) return [];
    $dir = history_dir_for($file);
    if (!is_dir($dir)) return [];
    $out = [];
    foreach ((array)@scandir($dir) as $f) {
        if ($f === '.' || $f === '..') continue;
        $p = $dir . '/' . $f;
        if (!is_file($p) || !preg_match('/^[A-Za-z0-9-]+\.json$/', $f)) continue;
        $out[] = ['name' => $f, 'ts' => (int)@filemtime($p), 'size' => (int)@filesize($p)];
    }
    usort($out, function ($a, $b) { return $b['ts'] <=> $a['ts']; });
    return $out;
}

/** 读一份快照的原文。名字必须是 history_list 里出现过的形态。 */
function history_read(string $file, string $name): ?string {
    if (!history_file_ok($file)) return null;
    if (!preg_match('/^[A-Za-z0-9-]+\.json$/', $name)) return null;
    $p = history_dir_for($file) . '/' . $name;
    if (!is_file($p)) return null;
    $s = @file_get_contents($p);
    return is_string($s) ? $s : null;
}

/** 历史目录的总占用（后台显示用）。 */
function history_usage(): array {
    $root = history_root();
    $files = 0; $bytes = 0;
    if (!is_dir($root)) return ['files' => 0, 'bytes' => 0];
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($it as $f) {
        if ($f->isFile()) { $files++; $bytes += $f->getSize(); }
    }
    return ['files' => $files, 'bytes' => $bytes];
}
