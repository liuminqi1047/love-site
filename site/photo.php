<?php
/* ============================================================
   情侣网站 · 照片代理（门禁之后才给图）
   ------------------------------------------------------------
   为什么要这一层：assets/img/uploads/ 与 assets/img/*.jpg 被 .htaccess
   整体拒绝直链，否则任何人拿到 URL 就能看照片，解锁密码形同虚设。
   这里在服务端校验解锁 Cookie，通过后才把文件读出来。

   用法：<img src="photo.php?f=assets/img/uploads/u260909_ab12cd34ef56.jpg">
   - 只允许两类路径：uploads/ 下的随机名照片、assets/img/ 下的栅格图
   - realpath 限定在项目目录内，拒绝 ../ 穿越
   - 只按真实图片类型输出（getimagesize），并带私有缓存 + ETag
   ============================================================ */

require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/access.php';

if (love_gate_required() && !love_gate_ok()) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo '需要先解锁';
    exit;
}

$f = $_GET['f'] ?? '';
/* f[]=x 这类数组参数：强转字符串会产生 "Array to string conversion" 警告
   （进错误日志、污染诊断），直接当非法路径 404 处理。 */
if (!is_string($f)) {
    http_response_code(404);
    exit;
}
$f = str_replace('\\', '/', $f);
$f = ltrim($f, '/');

/* 白名单：两张路径形态 + 只允许图片扩展名 */
$allowed = preg_match('#^assets/img/uploads/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp|gif)$#i', $f)
        || preg_match('#^assets/img/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp|gif)$#i', $f);
if (!$allowed) {
    http_response_code(404);
    exit;
}

$root = realpath(__DIR__);
$real = realpath(__DIR__ . '/' . $f);
if ($root === false || $real === false || strpos($real, $root . DIRECTORY_SEPARATOR) !== 0 || !is_file($real)) {
    http_response_code(404);
    exit;
}

$info = @getimagesize($real);
$mime = is_array($info) ? (string)($info['mime'] ?? '') : '';
if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
    http_response_code(415);
    exit;
}


/* ---------- 缩略图（相册列表用） ----------
   列表几十张原图（几百 KB 一张）在手机上既慢又费流量；这里按 ?w= 现生成
   一份缩略图，落盘缓存到 data/thumbs/（data/ 已被 nginx 拒绝直取，
   图只能经本文件出来，门禁仍然有效）。

   退回原图的情形：w 不在 80~1600 / 没有 gd / 动图（gif 动起来才有意义）/
   原图本来就比目标窄 / 生成失败。任何一条都只是"没省流量"，不会变成看不到图。 */
$size_pre = (int)filesize($real);
$wantW = isset($_GET['w']) && is_string($_GET['w']) ? (int)$_GET['w'] : 0;
if ($wantW >= 80 && $wantW <= 1600 && $mime !== 'image/gif' && function_exists('imagecreatefromstring')) {
    $ow = (int)($info[0] ?? 0);
    $oh = (int)($info[1] ?? 0);
    if ($ow > $wantW && $oh > 0) {
        $cacheDir = __DIR__ . '/data/thumbs';
        $key = md5($f . '|' . $wantW . '|' . $size_pre . '|' . (int)@filemtime($real));
        $cacheFile = $cacheDir . '/' . $key . '.jpg';
        if (!is_file($cacheFile)) {
            $rawImg = @file_get_contents($real);
            $im = $rawImg !== false ? @imagecreatefromstring($rawImg) : false;
            if ($im !== false) {
                $nw = $wantW;
                $nh = max(1, (int)round($oh * $nw / $ow));
                $dst = @imagecreatetruecolor($nw, $nh);
                if ($dst !== false) {
                    /* JPEG 没有透明通道：先铺白底，否则 PNG 的透明区域会变黑块 */
                    @imagefilledrectangle($dst, 0, 0, $nw, $nh, (int)@imagecolorallocate($dst, 255, 255, 255));
                    @imagecopyresampled($dst, $im, 0, 0, 0, 0, $nw, $nh, $ow, $oh);
                    if (!is_dir($cacheDir)) @mkdir($cacheDir, 0755, true);
                    @imagejpeg($dst, $cacheFile, 78);
                    @imagedestroy($dst);
                }
                @imagedestroy($im);
            }
        }
        if (is_file($cacheFile)) {
            header('Content-Type: image/jpeg');
            header('Content-Length: ' . (int)filesize($cacheFile));
            header('Cache-Control: private, max-age=604800');
            header('X-Content-Type-Options: nosniff');
            readfile($cacheFile);
            exit;
        }
    }
}

$size = (int)filesize($real);
$etag = '"' . md5($f . '|' . $size . '|' . (int)filemtime($real)) . '"';

header('Content-Type: ' . $mime);
header('Content-Length: ' . $size);
header('Cache-Control: private, max-age=3600');
header('ETag: ' . $etag);
header('X-Content-Type-Options: nosniff');

/* 304 协商：客户端可能发 "etag"、'W/"etag"'（弱校验）或多个逗号分隔的
   值（代理链）。旧实现只做整串全等比较，这几种常见形态全部命中不了，
   缓存白白失效。逐个剥掉 W/ 前缀后比较。 */
$inm = trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
if ($inm !== '') {
    foreach (explode(',', $inm) as $tag) {
        $tag = trim($tag);
        if ($tag === $etag || $tag === 'W/' . $etag || $tag === '*') {
            http_response_code(304);
            exit;
        }
    }
}

readfile($real);
