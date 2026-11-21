<?php
/* ============================================================
   情侣网站 · 双人身份
   ------------------------------------------------------------
   目的：让站点分得清"这台设备是谁"，于是界面上能标出
   "这条留言是 TA 写的"，也就能用各自的名字与头像说话。

   身份的唯一凭据是**服务端 Cookie 里的 deviceId**（lib/store.php
   的 love_device_id()）。前端不持有、也不提交任何设备凭据 —— 认领
   只是把"当前这台设备的 deviceId"记到 a / b 名下，别人的设备无法
   伪造成你。

   槽位约定：a = 一二（女方），b = 布布（男方）。
     注意：这里的 a/b 只是设备槽位，与默契测试 compat 的回合顺序 roles.a/b
     是两回事，不要互相套用；界面显示顺序统一为「一二 ♥ 布布」。
   数据：data/identity.json
     {"a":{"name":"","avatar":"💗","devices":["dev…"]},
      "b":{"name":"","avatar":"🌙","devices":[]}}
   设备数上限 8：一个人换手机、平板、电脑够用了；不设上限会让
   这份文件随"每次换设备"无限增长，也让"解除认领"很难收拾干净。
   ============================================================ */

declare(strict_types=1);

require_once __DIR__ . '/store.php';

const IDENTITY_FILE        = 'identity.json';
const IDENTITY_SLOTS       = ['a', 'b'];
const IDENTITY_MAX_DEVICES = 8;
const IDENTITY_NAME_MAX    = 12;   // 与 u_sub 的字符口径一致

/** 设备标识清洗：与 clean_id 同形（只留字母数字 _ -），但独立实现，
    避免 identity 层反向依赖内容层。 */
function identity_clean_device($v): string {
    $s = preg_replace('/[^A-Za-z0-9_-]/', '', u_str($v));
    return $s === '' ? '' : u_sub($s, 64);
}

function identity_base(): array {
    return [
        'a' => ['name' => '', 'avatar' => '💗', 'devices' => []],
        'b' => ['name' => '', 'avatar' => '🌙', 'devices' => []],
    ];
}

/** 读身份（一次请求内缓存：content_view 会为每条内容问一次"作者是谁"，
    不缓存就要把同一个文件读几十遍 —— 免费主机磁盘 I/O 很慢）。 */
function identity_get(): array {
    if (isset($GLOBALS['__love_identity']) && is_array($GLOBALS['__love_identity'])) {
        return $GLOBALS['__love_identity'];
    }
    $raw  = love_read(IDENTITY_FILE, []);
    $base = identity_base();
    $out  = $base;
    if (is_array($raw)) {
        foreach (IDENTITY_SLOTS as $k) {
            $p = $raw[$k] ?? null;
            if (!is_array($p)) continue;
            $name = u_sub(trim(u_str($p['name'] ?? '')), IDENTITY_NAME_MAX);
            $av   = u_sub(trim(u_str($p['avatar'] ?? '')), 4);
            $devs = [];
            foreach ((array)($p['devices'] ?? []) as $d) {
                $d = identity_clean_device($d);
                if ($d !== '' && !in_array($d, $devs, true)) $devs[] = $d;
            }
            $out[$k] = [
                'name'    => $name,
                'avatar'  => $av !== '' ? $av : $base[$k]['avatar'],
                'devices' => array_slice($devs, 0, IDENTITY_MAX_DEVICES),
            ];
        }
    }
    $GLOBALS['__love_identity'] = $out;
    return $out;
}

function identity_forget_cache(): void {
    unset($GLOBALS['__love_identity']);
}

/** 某台设备属于谁：'a' / 'b' / ''（未认领）。 */
function identity_of_device(string $dev): string {
    if ($dev === '') return '';
    $id = identity_get();
    foreach (IDENTITY_SLOTS as $k) {
        if (in_array($dev, $id[$k]['devices'], true)) return $k;
    }
    return '';
}

/** 认领：把当前设备记到某一方名下（同时从另一方移除 —— 一台设备不能同属两人）。 */
function identity_claim(string $dev, string $key): array {
    $dev = identity_clean_device($dev);
    if ($dev === '') return ['ok' => false, 'error' => '设备标识缺失，请刷新页面再试'];
    if (!in_array($key, IDENTITY_SLOTS, true)) return ['ok' => false, 'error' => '参数错误'];

    $out = love_mutate(IDENTITY_FILE, function ($d) use ($dev, $key) {
        if (!is_array($d)) $d = [];
        foreach (IDENTITY_SLOTS as $k) {
            $devs = is_array($d[$k]['devices'] ?? null) ? $d[$k]['devices'] : [];
            $devs = array_values(array_filter($devs, function ($x) use ($dev) {
                return identity_clean_device($x) !== $dev;
            }));
            if (!isset($d[$k]) || !is_array($d[$k])) $d[$k] = identity_base()[$k];
            $d[$k]['devices'] = $devs;
        }
        $d[$key]['devices'][] = $dev;
        $d[$key]['devices'] = array_slice(array_values($d[$key]['devices']), -IDENTITY_MAX_DEVICES);
        return $d;
    }, identity_base());
    if (!is_array($out)) return ['ok' => false, 'error' => '服务器繁忙'];
    identity_forget_cache();
    return ['ok' => true, 'key' => $key];
}

/** 解除本机的认领（换人用这台设备时点一下）。 */
function identity_release(string $dev): array {
    $dev = identity_clean_device($dev);
    if ($dev === '') return ['ok' => false, 'error' => '设备标识缺失'];
    $out = love_mutate(IDENTITY_FILE, function ($d) use ($dev) {
        if (!is_array($d)) $d = [];
        foreach (IDENTITY_SLOTS as $k) {
            $devs = is_array($d[$k]['devices'] ?? null) ? $d[$k]['devices'] : [];
            $d[$k]['devices'] = array_values(array_filter($devs, function ($x) use ($dev) {
                return identity_clean_device($x) !== $dev;
            }));
        }
        return $d;
    }, identity_base());
    if (!is_array($out)) return ['ok' => false, 'error' => '服务器繁忙'];
    identity_forget_cache();
    return ['ok' => true];
}

/** 改昵称 / 头像。名字允许清空（清空即回落到"我 / TA"这类默认称呼）。 */
function identity_profile(string $key, $name, $avatar): array {
    if (!in_array($key, IDENTITY_SLOTS, true)) return ['ok' => false, 'error' => '参数错误'];
    $n = u_sub(trim(u_str($name)), IDENTITY_NAME_MAX);
    $a = u_sub(trim(u_str($avatar)), 4);
    if ($a === '') $a = identity_base()[$key]['avatar'];

    $out = love_mutate(IDENTITY_FILE, function ($d) use ($key, $n, $a) {
        if (!is_array($d)) $d = [];
        if (!isset($d[$key]) || !is_array($d[$key])) $d[$key] = identity_base()[$key];
        $d[$key]['name']   = $n;
        $d[$key]['avatar'] = $a;
        if (!isset($d[$key]['devices']) || !is_array($d[$key]['devices'])) $d[$key]['devices'] = [];
        return $d;
    }, identity_base());
    if (!is_array($out)) return ['ok' => false, 'error' => '服务器繁忙'];
    identity_forget_cache();
    return ['ok' => true, 'name' => $n, 'avatar' => $a];
}

/** 对外视图（绝不含 devices —— 那等于把"谁的设备"这份凭据交出去）。 */
function identity_public(): array {
    $id = identity_get();
    $out = ['people' => []];
    foreach (IDENTITY_SLOTS as $k) {
        $out['people'][$k] = [
            'name'    => $id[$k]['name'],
            'avatar'  => $id[$k]['avatar'],
            'claimed' => count($id[$k]['devices']) > 0,
        ];
    }
    return $out;
}

/** 内容作者的展示信息：未认领时返回 null（前端就不画徽章）。 */
function identity_author(string $dev): ?array {
    $k = identity_of_device($dev);
    if ($k === '') return null;
    $id = identity_get();
    return ['key' => $k, 'name' => $id[$k]['name'], 'avatar' => $id[$k]['avatar']];
}
