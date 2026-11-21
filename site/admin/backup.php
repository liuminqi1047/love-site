<?php
/* ============================================================
   「完整备份包」下载
   ------------------------------------------------------------
   与 admin/export.php 的区别：
     export.php  只管 data/*.json + 照片，给人手翻/存档用，**没有导入端**；
     backup.php  产出 lib/archive.php 定义的 love-backup 包，
                 后台「上传备份包恢复」能原样吃下去 —— 换主机只带这一个文件。

   参数：?music=0 不打包音乐（体积从 11MB 降到几百 KB，弱网时更快）。
   鉴权：必须是已登录的后台会话，与 export.php 同一套。
   ============================================================ */

require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/access.php';
require_once __DIR__ . '/../lib/archive.php';

love_session();
if (!love_logged_in()) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo '需要先在后台登录后再下载备份。';
    exit;
}

$root      = dirname(__DIR__);
$withMusic = !(isset($_GET['music']) && (string)$_GET['music'] === '0');

$entries = love_archive_collect($root, $withMusic);
if ($entries === []) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo '没有可备份的数据（data/ 为空或不可读）。';
    exit;
}

$manifest = love_archive_manifest($root, $entries, $withMusic);
$json = json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

$name = 'love-backup-' . love_app_version($root) . '-' . date('Ymd-His') . '.zip';
header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . $name . '"');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');
/* 不写 Content-Length：zip 头与中央目录的字节数要精确算，算错一点
   浏览器就会判定"传输中断"（大包上尤其明显）。交给 PHP 分块输出。 */

love_zip_send(['manifest.json' => $json] + $entries);
