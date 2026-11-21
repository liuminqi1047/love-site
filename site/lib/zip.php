<?php
/* ============================================================
   极简 ZIP 打包（store 方式，不压缩）
   ------------------------------------------------------------
   主机没装 ZipArchive（php -m 只有 zlib/gd），所以自己拼 ZIP 结构：
   本地头 + 数据 + 中央目录 + EOCD。
   用 store 而不是 deflate：照片本来就是 JPEG（再压也压不动），
   JSON 只有几十 KB，省掉压缩反而少出错。
   上限：单文件 < 4GB、条目 < 65535，个人站点足够。
   ============================================================ */

function love_crc32_file(string $path): int {
    $h = hash_init('crc32b');
    $fh = @fopen($path, 'rb');
    if (!$fh) return 0;
    while (!feof($fh)) {
        $buf = fread($fh, 262144);
        if ($buf === false) break;
        hash_update($h, $buf);
    }
    fclose($fh);
    return (int)hexdec(hash_final($h));
}

/**
 * 把若干条目写进 php://output（调用方负责先发 Content-Type/Disposition）。
 * $entries: [归档内路径 => 绝对文件路径 | 字符串内容]
 */
function love_zip_send(array $entries): void {
    $cd = '';
    $offset = 0;
    $count = 0;
    $out = fopen('php://output', 'wb');

    foreach ($entries as $name => $src) {
        $name = ltrim(str_replace('\\', '/', (string)$name), '/');
        if ($name === '') continue;

        $isFile = is_string($src) && @is_file($src);
        $data   = $isFile ? null : (string)$src;
        $size   = $isFile ? (int)@filesize($src) : strlen($data);
        $crc    = $isFile ? love_crc32_file($src) : (int)hexdec(hash('crc32b', $data));

        $local = pack('V', 0x04034b50) . pack('v', 20) . pack('v', 0) . pack('v', 0)
               . pack('v', 0) . pack('v', 0)
               . pack('V', $crc) . pack('V', $size) . pack('V', $size)
               . pack('v', strlen($name)) . pack('v', 0) . $name;

        fwrite($out, $local);
        if ($isFile) {
            $fh = @fopen($src, 'rb');
            if ($fh) {
                while (!feof($fh)) {
                    $buf = fread($fh, 262144);
                    if ($buf === false) break;
                    fwrite($out, $buf);
                }
                fclose($fh);
            }
        } else {
            fwrite($out, $data);
        }

        /* 中央目录里的 offset 指向本地头起点，所以要在累加之前取 */
        $cd .= pack('V', 0x02014b50) . pack('v', 20) . pack('v', 20) . pack('v', 0)
             . pack('v', 0) . pack('v', 0) . pack('v', 0)
             . pack('V', $crc) . pack('V', $size) . pack('V', $size)
             . pack('v', strlen($name)) . pack('v', 0) . pack('v', 0)
             . pack('v', 0) . pack('v', 0) . pack('V', 0)
             . pack('V', $offset) . $name;

        $offset += strlen($local) + $size;
        $count++;
    }

    $cdStart = $offset;
    fwrite($out, $cd);
    fwrite($out, pack('V', 0x06054b50) . pack('v', 0) . pack('v', 0)
                 . pack('v', $count) . pack('v', $count)
                 . pack('V', strlen($cd)) . pack('V', $cdStart) . pack('v', 0));
    fclose($out);
}
