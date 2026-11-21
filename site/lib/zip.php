<?php
/* ============================================================
   极简 ZIP 打包 / 解包（store 方式，不压缩）
   ------------------------------------------------------------
   主机没装 ZipArchive（php -m 只有 zlib/gd），所以自己拼 ZIP 结构：
   本地头 + 数据 + 中央目录 + EOCD。
   用 store 而不是 deflate：照片本来就是 JPEG（再压也压不动），
   JSON 只有几十 KB，省掉压缩反而少出错。
   上限：单文件 < 4GB、条目 < 65535，个人站点足够。

   写入：love_zip_stream()（任意流）/ love_zip_send()（下载）/ love_zip_write_file()（落盘）
   读取：love_zip_index() + love_zip_entry()——备份包恢复用，支持 store 与 deflate
         （浏览器/系统压缩工具重新打过包的文件是 deflate，必须能读）。
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
 * 把若干条目写进一个可写流。
 * $entries: [归档内路径 => 绝对文件路径 | 字符串内容]
 */
function love_zip_stream(array $entries, $out): void {
    $cd = '';
    $offset = 0;
    $count = 0;

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
}

/** 直接输出到响应体（调用方负责先发 Content-Type/Disposition）。 */
function love_zip_send(array $entries): void {
    $out = fopen('php://output', 'wb');
    love_zip_stream($entries, $out);
    fclose($out);
}

/** 写到文件（CLI 打包用）。成功返回 true。 */
function love_zip_write_file(array $entries, string $path): bool {
    $out = @fopen($path, 'wb');
    if (!$out) return false;
    love_zip_stream($entries, $out);
    fclose($out);
    return true;
}

/**
 * 读 ZIP 中央目录，返回 [归档内路径 => 元信息]。
 * 元信息：method / size / csize / crc / offset
 * 只支持单卷、无 ZIP64 的包（本站备份包必然满足；外部工具打的小包也满足）。
 */
function love_zip_index(string $path): array {
    $size = @filesize($path);
    if (!$size || $size < 22) return [];
    $fh = @fopen($path, 'rb');
    if (!$fh) return [];

    /* EOCD 在文件尾，注释最长 65535，往回找 64KB+22 足够 */
    $tailLen = min($size, 65557);
    fseek($fh, $size - $tailLen);
    $tail = fread($fh, $tailLen);
    $pos = strrpos($tail, "PK\x05\x06");
    if ($pos === false) { fclose($fh); return []; }

    $eocd = unpack('Vsig/vdisk/vcddisk/vcount/vtotal/Vcdsize/Vcdoff/vclen', substr($tail, $pos, 22));
    $count = (int)($eocd['total'] ?? 0);
    $cdOff = (int)($eocd['cdoff'] ?? 0);
    $cdSize = (int)($eocd['cdsize'] ?? 0);
    if ($count <= 0 || $cdOff <= 0 || $cdSize <= 0) { fclose($fh); return []; }

    fseek($fh, $cdOff);
    $cd = fread($fh, $cdSize);
    fclose($fh);

    $out = [];
    $p = 0;
    for ($i = 0; $i < $count; $i++) {
        if (substr($cd, $p, 4) !== "PK\x01\x02") break;
        $h = unpack(
            'Vsig/vmade/vneed/vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vsize/vnamelen/vextralen/vcommentlen/vdisk/vintattr/Vextattr/Voffset',
            substr($cd, $p, 46)
        );
        $name = substr($cd, $p + 46, (int)$h['namelen']);
        $name = str_replace('\\', '/', $name);
        if ($name !== '' && strpos($name, "\0") === false) {
            $out[$name] = [
                'method' => (int)$h['method'],
                'size'   => (int)$h['size'],
                'csize'  => (int)$h['csize'],
                'crc'    => (int)$h['crc'],
                'offset' => (int)$h['offset'],
            ];
        }
        $p += 46 + (int)$h['namelen'] + (int)$h['extralen'] + (int)$h['commentlen'];
    }
    return $out;
}

/** 取一个条目的原始内容；CRC 不符返回 null（被截断/被改过）。 */
function love_zip_entry(string $path, array $meta): ?string {
    $fh = @fopen($path, 'rb');
    if (!$fh) return null;
    fseek($fh, (int)$meta['offset']);
    $lh = fread($fh, 30);
    if (strlen($lh) < 30 || substr($lh, 0, 4) !== "PK\x03\x04") { fclose($fh); return null; }
    $h = unpack('Vsig/vneed/vflags/vmethod/vtime/vdate/Vcrc/Vcsize/Vsize/vnamelen/vextralen', $lh);
    fseek($fh, (int)$meta['offset'] + 30 + (int)$h['namelen'] + (int)$h['extralen']);
    $raw = (int)$meta['csize'] > 0 ? fread($fh, (int)$meta['csize']) : '';
    fclose($fh);

    $data = $raw;
    if ((int)$meta['method'] === 8) {
        $data = @gzinflate($raw);
        if ($data === false) $data = @gzuncompress($raw);
        if ($data === false) return null;
    } elseif ((int)$meta['method'] !== 0) {
        return null;   // 不支持 bzip2/lzma 之类
    }

    if ((int)$meta['crc'] !== 0 && (int)hexdec(hash('crc32b', $data)) !== (int)$meta['crc']) return null;
    if ((int)$meta['size'] > 0 && strlen($data) !== (int)$meta['size']) return null;
    return $data;
}
