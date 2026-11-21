<?php
/* ============================================================
   情侣网站 · 通知中心
   ------------------------------------------------------------
   只做一件事：把"最近发生过什么"整理成**条目**交给前端。
   为什么不在这里判"已读"：
     已读是"每台设备各自的状态"。放进 data/ 就要为每个 device 存一份，
     还要处理清理与并发；这里只输出稳定 id，前端用 localStorage 记
     已读集合即可 —— 服务端零新增状态，换设备各自算各自的。
   条目来源（都只取"最近发生"的，避免一次塞几十条）：
     photo   新照片（content.json，近 60 天）
     capsule 胶囊到了开启日（content.json，openAt <= 今天）
     daily   对方回答了今天的一问（daily.json）
     letter  新情书（config.json，近 14 天）
   ============================================================ */

require_once __DIR__ . '/store.php';
require_once __DIR__ . '/daily.php';

function notify_items(string $dev, int $limit = 30): array {
    $cfg   = love_read('config.json', []);
    $ct    = love_read('content.json', []);
    $today = date('Y-m-d');
    $items = [];

    /* ---------- 新照片 ---------- */
    foreach ((array)($ct['photos'] ?? []) as $p) {
        if (!is_array($p)) continue;
        $ts = (int)($p['ts'] ?? 0);
        if ($ts <= 0 || $ts < time() - 60 * 86400) continue;
        $cap = trim(u_str($p['cap'] ?? ''));
        $items[] = [
            'id'    => 'ph:' . md5(u_str($p['src'] ?? '') . '|' . $ts),
            'type'  => 'photo',
            'title' => $cap !== '' ? '新照片：' . $cap : '传了新照片',
            'ts'    => $ts,
            'url'   => 'gallery.html',
        ];
    }

    /* ---------- 胶囊到了开启日 ---------- */
    foreach ((array)($ct['capsules'] ?? []) as $c) {
        if (!is_array($c)) continue;
        $openAt = preg_replace('/[^0-9-]/', '', u_str($c['openAt'] ?? ''));
        if ($openAt === '' || $openAt > $today) continue;
        $t  = trim(u_str($c['title'] ?? ''));
        $ts = (int)($c['ts'] ?? 0);
        if ($ts <= 0) { $parsed = strtotime($openAt); $ts = $parsed ?: 0; }
        $items[] = [
            'id'    => 'cp:' . u_str($c['uid'] ?? md5($openAt . $t)),
            'type'  => 'capsule',
            'title' => '时光胶囊可以打开了：' . ($t !== '' ? $t : '未命名'),
            'ts'    => $ts,
            'url'   => 'letter.html',
        ];
    }

    /* ---------- 对方回答了每日一问 ---------- */
    if ($dev !== '') {
        $d = daily_view($dev);
        if (!empty($d['partnerAnswered'])) {
            $ts = strtotime((string)($d['date'] ?? '')) ?: time();
            $items[] = [
                'id'    => 'dl:' . (string)($d['date'] ?? $today),
                'type'  => 'daily',
                'title' => 'TA 回答了今天的每日一问',
                'ts'    => $ts,
                'url'   => 'home.html#daily',
            ];
        }
    }

    /* ---------- 新情书（按 date 字段，近 14 天） ---------- */
    $since = date('Y-m-d', time() - 14 * 86400);
    foreach ((array)($cfg['letters'] ?? []) as $l) {
        if (!is_array($l)) continue;
        $date = u_str($l['date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || $date < $since) continue;
        $title = trim(u_str($l['title'] ?? ''));
        $items[] = [
            'id'    => 'lt:' . md5($date . '|' . $title),
            'type'  => 'letter',
            'title' => '新情书：' . ($title !== '' ? $title : '无题'),
            'ts'    => strtotime($date) ?: 0,
            'url'   => 'letter.html',
        ];
    }

    usort($items, function ($a, $b) { return ($b['ts'] ?? 0) <=> ($a['ts'] ?? 0); });
    return array_slice($items, 0, $limit);
}
