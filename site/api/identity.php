<?php
/* ============================================================
   情侣网站 · 身份接口（公开，需先解锁）
   ------------------------------------------------------------
   GET  ?action=state   → 我是谁 + 两个人的昵称头像（不含设备标识）
   POST {action:'claim', key:'a'|'b'}     认领本机
   POST {action:'release'}                解除本机认领
   POST {action:'profile', key, name, avatar}  改昵称/头像

   身份凭据只来自服务端 HttpOnly Cookie（love_device_id()），
   请求体里的 deviceId 一律忽略 —— 与 api/content.php 同一口径。
   ============================================================ */

require_once __DIR__ . '/../lib/store.php';
require_once __DIR__ . '/../lib/access.php';
require_once __DIR__ . '/../lib/identity.php';

if (!love_gate_ok()) love_json(['ok' => false, 'error' => '需要先解锁', 'locked' => true], 401);

$dev = love_device_id();

function identity_state(string $dev): array {
    $pub = identity_public();
    $key = identity_of_device($dev);
    $me  = null;
    if ($key !== '') {
        $me = ['key' => $key, 'name' => $pub['people'][$key]['name'], 'avatar' => $pub['people'][$key]['avatar']];
    }
    return ['ok' => true, 'me' => $me, 'people' => $pub['people'], 'has_device' => $dev !== ''];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET') {
    love_json(identity_state($dev));
}

if (!love_origin_ok()) {
    love_json(['ok' => false, 'error' => '请求来源不合法'], 403);
}
if (!love_rate_allowed('content')) {
    love_json(['ok' => false, 'error' => '操作太频繁，稍后再试'], 429);
}

$in = love_body();
$action = u_str($in['action'] ?? '');
switch ($action) {
    case 'claim': {
        $r = identity_claim($dev, u_str($in['key'] ?? ''));
        if (empty($r['ok'])) love_json($r, 400);
        love_json(identity_state($dev));
    }
    case 'release': {
        $r = identity_release($dev);
        if (empty($r['ok'])) love_json($r, 400);
        love_json(identity_state($dev));
    }
    case 'profile': {
        $key = u_str($in['key'] ?? '');
        /* 只允许改"自己认领的那一位"或尚未被任何人认领的那一位：
           否则谁都能把对方的名字改掉。 */
        $mine = identity_of_device($dev);
        $pub  = identity_public();
        if ($key !== $mine) {
            $targetClaimed = !empty($pub['people'][$key]['claimed']);
            if ($key === '' || !in_array($key, IDENTITY_SLOTS, true) || $targetClaimed) {
                love_json(['ok' => false, 'error' => '只能修改自己或还没人的那一位'], 403);
            }
        }
        $r = identity_profile($key, $in['name'] ?? '', $in['avatar'] ?? '');
        if (empty($r['ok'])) love_json($r, 400);
        love_json(identity_state($dev));
    }
    default:
        love_json(['ok' => false, 'error' => '未知操作'], 400);
}
