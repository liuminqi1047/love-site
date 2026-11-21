#!/usr/bin/env php
<?php
/* ============================================================
   命令行：生成 / 校验便携备份包（与后台「完整备份包」同一套代码）
   ------------------------------------------------------------
   用法：
     php archive.php --root /var/www/love --out /data/love-backup.zip
     php archive.php --root /var/www/love --out /data/x.zip --no-music
     php archive.php --check /data/love-backup.zip          # 只校验，不落盘

   主机上放在 /data/love-build/archive.php，由 tools/pull-backup.sh 调用。
   输出最后一行是 RESULT<TAB>json，方便脚本解析。
   ============================================================ */

$opts = getopt('', ['root:', 'out:', 'no-music', 'check:']);
$root = rtrim((string)($opts['root'] ?? '/var/www/love'), '/');

if (!is_dir($root . '/lib')) {
    fwrite(STDERR, "不是站点目录：{$root}\n");
    exit(2);
}
require $root . '/lib/store.php';
require $root . '/lib/archive.php';

function out(array $o): void {
    echo "RESULT\t" . json_encode($o, JSON_UNESCAPED_UNICODE) . "\n";
    /* 给 shell 用的定长行，省得脚本里再解析 JSON */
    if (isset($o['sha256'])) {
        echo "SHA256\t" . $o['sha256'] . "\n";
        echo "BYTES\t" . (int)$o['bytes'] . "\n";
    }
}

if (isset($opts['check'])) {
    $vf = love_archive_verify((string)$opts['check']);
    out([
        'ok'      => $vf['ok'],
        'errors'  => $vf['errors'],
        'warn'    => $vf['warnings'],
        'version' => $vf['manifest']['appVersion'] ?? null,
        'counts'  => $vf['manifest']['counts'] ?? null,
    ]);
    exit($vf['ok'] ? 0 : 1);
}

if (empty($opts['out'])) {
    fwrite(STDERR, "缺少 --out\n");
    exit(2);
}

$withMusic = !isset($opts['no-music']);
$out = (string)$opts['out'];
$t0 = microtime(true);

$entries = love_archive_collect($root, $withMusic);
$m = love_archive_build($root, $out, $withMusic);
if ($m === null) {
    out(['ok' => false, 'error' => '打包失败（目录不可读或写不进 ' . $out . '）']);
    exit(1);
}

$vf = love_archive_verify($out);
out([
    'ok'       => $vf['ok'],
    'file'     => $out,
    'bytes'    => (int)@filesize($out),
    'sha256'   => (string)@hash_file('sha256', $out),
    'version'  => $m['appVersion'],
    'counts'   => $m['counts'],
    'music'    => $withMusic,
    'ms'       => (int)round((microtime(true) - $t0) * 1000),
    'errors'   => $vf['errors'],
    'warnings' => $vf['warnings'],
]);
exit($vf['ok'] ? 0 : 1);
