<?php
/* ============================================================
   情侣网站 · 心愿瓶接口（公开，需先解锁）
   ------------------------------------------------------------
   GET  ?action=all    → {states, custom}
   POST {action:'add', title, text}
   POST {action:'status', id, status:'want'|'doing'|'done'}
   POST {action:'delete', id}    只能删自己这台设备加的心愿

   状态键由前端按 title+text 算（默认心愿只在 config.js 里，服务端读不到），
   服务端只校验形状 —— 见 lib/wishes.php 顶部说明。
   ============================================================ */

require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/access.php';
require_once __DIR__ . '/../lib/wishes.php';

if (!love_gate_ok()) love_json(['ok' => false, 'error' => '需要先解锁', 'locked' => true], 401);

$dev = love_device_id();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    love_json(['ok' => true] + wish_public($dev));
}

if (!love_origin_ok()) love_json(['ok' => false, 'error' => '请求来源不合法'], 403);
if (!love_rate_allowed('content')) love_json(['ok' => false, 'error' => '操作太频繁，歇一会儿再试'], 429);

$in = love_body();
switch (u_str($in['action'] ?? '')) {
    case 'add': {
        $r = wish_add($in, $dev);
        if (empty($r['ok'])) love_json($r, 400);
        love_json($r + ['data' => wish_public($dev)]);
    }
    case 'status': {
        $r = wish_set_status($in, $dev);
        if (empty($r['ok'])) love_json($r, 400);
        love_json(['ok' => true, 'id' => $r['id'], 'status' => $r['status']]);
    }
    case 'delete': {
        $r = wish_delete($in, $dev);
        if (empty($r['ok'])) love_json($r, 400);
        love_json(['ok' => true]);
    }
    default:
        love_json(['ok' => false, 'error' => '未知操作'], 400);
}
