<?php
/* ============================================================
   情侣网站 · 心愿瓶状态
   ------------------------------------------------------------
   心愿的**文案**仍然来自 config（config.js 默认值 + 后台覆盖），
   这样后台"情书与心愿"那一栏不用改一行；这里只存"状态"这类
   运行时数据。为什么不把文案也搬过来：
     cfg 的校验器（lib/config.php 的 sanitize_cfg）是白名单式的，
     往每条心愿里塞 status/uid 会被它静默剥掉；而访客端又要能改
     状态 —— 两条写入路径改同一份文件，迟早打架。

   数据：data/wishes.json
     {"states":{"w1a2b3c4":{"status":"doing","ts":1700000000}},
      "custom":[{"uid":"wab12cd34ef","title":"…","text":"…",
                 "status":"want","ts":1700000000,"deviceId":"…"}]}

   states 的键由**前端**按 title+text 算出来（默认心愿只存在于 config.js，
   服务端根本读不到那批文案，所以键只能由前端给），服务端只校验格式；
   custom 是访客在页面上新增的心愿（有 uid，可删）。
   ============================================================ */

declare(strict_types=1);

require_once __DIR__ . '/store.php';

const WISH_FILE        = 'wishes.json';
const WISH_STATUSES    = ['want', 'doing', 'done'];
const WISH_MAX_CUSTOM  = 200;
const WISH_MAX_STATES  = 500;
const WISH_TITLE_MAX   = 30;
const WISH_TEXT_MAX    = 200;

function wish_status_ok($s): string {
    $s = u_str($s);
    return in_array($s, WISH_STATUSES, true) ? $s : 'want';
}

function wish_uid_ok($v): bool {
    return is_string($v) && preg_match('/^w[0-9a-f]{4,20}$/', $v) === 1;
}

/** 读取并归一。畸形数据一律丢弃（宁少一条，也不把脏结构下发到前端）。 */
function wish_get(): array {
    $raw = love_read(WISH_FILE, []);
    $out = ['states' => [], 'custom' => []];
    if (!is_array($raw)) return $out;

    $states = $raw['states'] ?? null;
    if (is_array($states)) {
        $n = 0;
        foreach ($states as $id => $st) {
            if ($n >= WISH_MAX_STATES) break;
            if (!wish_uid_ok($id) || !is_array($st)) continue;
            $out['states'][$id] = ['status' => wish_status_ok($st['status'] ?? ''), 'ts' => (int)($st['ts'] ?? 0)];
            $n++;
        }
    }

    foreach ((array)($raw['custom'] ?? []) as $it) {
        if (!is_array($it)) continue;
        $uid = u_str($it['uid'] ?? '');
        $t   = u_sub(trim(u_str($it['title'] ?? '')), WISH_TITLE_MAX);
        if (!wish_uid_ok($uid) || $t === '') continue;
        $out['custom'][] = [
            'uid'      => $uid,
            'title'    => $t,
            'text'     => u_sub(trim(u_str($it['text'] ?? '')), WISH_TEXT_MAX),
            'status'   => wish_status_ok($it['status'] ?? ''),
            'ts'       => (int)($it['ts'] ?? 0),
            'deviceId' => u_str($it['deviceId'] ?? ''),
        ];
        if (count($out['custom']) >= WISH_MAX_CUSTOM) break;
    }
    return $out;
}

function wish_public(string $dev): array {
    $d = wish_get();
    $custom = [];
    foreach ($d['custom'] as $it) {
        $mine = $dev !== '' && $it['deviceId'] === $dev;
        unset($it['deviceId']);
        $it['mine'] = $mine;
        $custom[] = $it;
    }
    return ['states' => (object)$d['states'], 'custom' => $custom];
}

function wish_add(array $in, string $dev): array {
    $title = u_sub(trim(u_str($in['title'] ?? '')), WISH_TITLE_MAX);
    $text  = u_sub(trim(u_str($in['text'] ?? '')), WISH_TEXT_MAX);
    $st    = wish_status_ok($in['status'] ?? 'want');
    if ($title === '') return ['ok' => false, 'error' => '先给心愿起个名字吧'];
    if ($dev === '') return ['ok' => false, 'error' => '设备标识缺失，请刷新页面'];

    $rec = null;
    $out = love_mutate(WISH_FILE, function ($d) use ($title, $text, $st, $dev, &$rec) {
        if (!is_array($d)) $d = [];
        $custom = is_array($d['custom'] ?? null) ? $d['custom'] : [];
        if (count($custom) >= WISH_MAX_CUSTOM) return $d;   // 满了就不写，$rec 保持 null
        $uid = 'w' . bin2hex(random_bytes(5));
        $rec = [
            'uid' => $uid, 'title' => $title, 'text' => $text,
            'status' => $st, 'ts' => time(), 'deviceId' => $dev,
        ];
        $custom[] = $rec;
        $d['custom'] = $custom;
        return $d;
    }, ['states' => [], 'custom' => []]);
    if (!is_array($out) || $rec === null) return ['ok' => false, 'error' => '服务器繁忙或心愿瓶已满'];
    $pub = $rec;
    unset($pub['deviceId']);
    $pub['mine'] = true;
    return ['ok' => true, 'record' => $pub];
}

/** 改状态。id 同时可能是 custom 的 uid，也可能只是前端算出来的 config 心愿键。 */
function wish_set_status(array $in, string $dev): array {
    $id = u_str($in['id'] ?? '');
    $st = u_str($in['status'] ?? '');
    if (!wish_uid_ok($id)) return ['ok' => false, 'error' => '参数错误'];
    if (!in_array($st, WISH_STATUSES, true)) return ['ok' => false, 'error' => '状态不合法'];

    $found = false;
    $out = love_mutate(WISH_FILE, function ($d) use ($id, $st, &$found) {
        if (!is_array($d)) $d = [];
        $custom = is_array($d['custom'] ?? null) ? $d['custom'] : [];
        foreach ($custom as $i => $it) {
            if (is_array($it) && u_str($it['uid'] ?? '') === $id) {
                $custom[$i]['status'] = $st;
                if ($st === 'done') $custom[$i]['doneAt'] = date('Y-m-d');
                $d['custom'] = $custom;
                $found = true;
                return $d;
            }
        }
        $states = is_array($d['states'] ?? null) ? $d['states'] : [];
        if (count($states) >= WISH_MAX_STATES && !isset($states[$id])) return $d;
        $states[$id] = ['status' => $st, 'ts' => time()];
        if ($st === 'done') $states[$id]['doneAt'] = date('Y-m-d');
        $d['states'] = $states;
        $found = true;
        return $d;
    }, ['states' => [], 'custom' => []]);
    if (!is_array($out) || !$found) return ['ok' => false, 'error' => '没找到这个心愿'];
    return ['ok' => true, 'id' => $id, 'status' => $st];
}

/** 删自建心愿。只能删自己这台设备加的 —— config 里的心愿归后台管。 */
function wish_delete(array $in, string $dev): array {
    $id = u_str($in['id'] ?? '');
    if (!wish_uid_ok($id) || $dev === '') return ['ok' => false, 'error' => '参数错误'];

    $hit = false;
    $out = love_mutate(WISH_FILE, function ($d) use ($id, $dev, &$hit) {
        if (!is_array($d)) $d = [];
        $custom = is_array($d['custom'] ?? null) ? $d['custom'] : [];
        $keep = [];
        foreach ($custom as $it) {
            if (is_array($it) && u_str($it['uid'] ?? '') === $id) {
                if (u_str($it['deviceId'] ?? '') !== $dev) { $keep[] = $it; continue; }  // 别人的不动
                $hit = true;
                continue;
            }
            $keep[] = $it;
        }
        $d['custom'] = $keep;
        return $d;
    }, ['states' => [], 'custom' => []]);
    if (!is_array($out)) return ['ok' => false, 'error' => '服务器繁忙'];
    if (!$hit) return ['ok' => false, 'error' => '只能删除自己加的心愿'];
    return ['ok' => true];
}

/** 后台：整份替换（管理员编辑/清理用）。 */
function wish_admin_replace(array $items): array {
    $custom = [];
    foreach ($items as $it) {
        if (!is_array($it)) continue;
        $t = u_sub(trim(u_str($it['title'] ?? '')), WISH_TITLE_MAX);
        if ($t === '') continue;
        $uid = wish_uid_ok(u_str($it['uid'] ?? '')) ? u_str($it['uid']) : ('w' . bin2hex(random_bytes(5)));
        $custom[] = [
            'uid' => $uid, 'title' => $t,
            'text' => u_sub(trim(u_str($it['text'] ?? '')), WISH_TEXT_MAX),
            'status' => wish_status_ok($it['status'] ?? 'want'),
            'ts' => (int)($it['ts'] ?? time()),
            'deviceId' => u_str($it['deviceId'] ?? ''),
        ];
        if (count($custom) >= WISH_MAX_CUSTOM) break;
    }
    $cur = wish_get();
    $out = love_mutate(WISH_FILE, function () use ($custom, $cur) {
        return ['states' => (object)$cur['states'], 'custom' => $custom];
    }, ['states' => [], 'custom' => []], true);
    return is_array($out) ? ['ok' => true, 'count' => count($custom)] : ['ok' => false, 'error' => '写入失败'];
}
