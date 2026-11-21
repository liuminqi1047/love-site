<?php
/* ============================================================
   「一键导出」：把全部数据 + 照片打成一个 zip 直接下载
   ------------------------------------------------------------
   为什么不做成 admin/api.php 的一个 action：
     那个接口统一返回 JSON，而这里要吐二进制流、还要带下载头。
     单独一个 export.php 更简单，也不会污染 JSON 接口的错误处理。
   鉴权：必须是已登录的后台会话（与后台接口同一套 session）。
   包含：data/*.json（配置/内容/每日一问/默契/admin/music）
         assets/img/uploads/*（照片原图）
         README.txt（恢复说明）
   不含：assets/music（体积大，可单独下载）与门禁密钥 gate_secret（不该外带）。
   ============================================================ */

require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/access.php';
require_once __DIR__ . '/../lib/zip.php';

love_session();
if (!love_logged_in()) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo '需要先在后台登录后再导出。';
    exit;
}

$root  = dirname(__DIR__);
$files = [];

/* 数据文件：排除安全计数与密钥 */
$skip = ['security.json', 'gate_secret'];
foreach (glob($root . '/data/*.json') ?: [] as $p) {
    if (in_array(basename($p), $skip, true)) continue;
    $files['data/' . basename($p)] = $p;
}

/* 照片原图（跳过 .htaccess 之类的隐藏文件） */
foreach (glob($root . '/assets/img/uploads/*') ?: [] as $p) {
    $base = basename($p);
    if ($base === '' || $base[0] === '.' || !is_file($p)) continue;
    $files['photos/' . $base] = $p;
}

$manifest = "情侣网站 · 全量导出\n"
    . '时间：' . date('Y-m-d H:i:s') . "\n"
    . '条目：' . (count($files) + 1) . " 个\n\n"
    . "目录说明\n"
    . "  data/    全部 JSON 数据（config 配置 / content 照片与胶囊 / daily 每日一问 /\n"
    . "           compat 默契度 / admin 管理员 / music 音乐索引）\n"
    . "  photos/  上传的照片原图\n\n"
    . "恢复方法\n"
    . "  1) 把 data/*.json 覆盖回站点的 data/ 目录（先备份现有文件）；\n"
    . "  2) 把 photos/* 放回站点的 assets/img/uploads/；\n"
    . "  3) 权限：数据文件 www-data 可写（chown -R www-data:www-data data assets/img/uploads）。\n\n"
    . "未包含\n"
    . "  assets/music/  音乐文件体积大，需要的话在后台「背景音乐」里单独下载；\n"
    . "  data/gate_secret  门禁签名密钥，外带会让人能伪造解锁 Cookie（重新生成即可）。\n";

header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="love-export-' . date('Ymd-Hi') . '.zip"');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

love_zip_send(['README.txt' => $manifest] + $files);
