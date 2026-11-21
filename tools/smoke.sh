#!/bin/bash
# 站点冒烟测试：一条命令跑完"页面/接口/静态资源/构建一致性"
#
#   ./smoke.sh                 # HTTP 层 + 构建一致性
#   ./smoke.sh --deep          # 额外用 chromium 真跑一次首页（查 JS 报错、播放器、门禁）
#   SITE_URL=http://127.0.0.1:3000 SITE_ROOT=/var/www/love ./smoke.sh
#
# 退出码：0 全通过，1 有失败项。用在每次改完代码之后。
set -uo pipefail

SITE_URL="${SITE_URL:-http://127.0.0.1:3000}"
SITE_ROOT="${SITE_ROOT:-/var/www/love}"
BUILD="${BUILD:-/data/love-build/build.py}"
DEEP=0
[[ "${1:-}" == "--deep" ]] && DEEP=1

pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
body() { curl -s "$1"; }

section "1. 页面"
for p in / /home.html /gallery.html /timeline.html /anniversary.html /letter.html /game.html /achievements.html /admin/index.php; do
    c=$(code "$SITE_URL$p")
    [[ "$c" == "200" ]] && ok "$p → $c" || bad "$p → $c（应为 200）"
done

section "2. 接口与注入"
c=$(code "$SITE_URL/api/config.php")
[[ "$c" == "200" ]] && ok "/api/config.php → 200" || bad "/api/config.php → $c"
for key in __SERVER_GATE__ __SERVER_MUSIC__ __SERVER_CONTENT__; do
    body "$SITE_URL/api/config.php" | grep -q "$key" && ok "注入含 $key" || bad "注入缺少 $key"
done

section "3. 私有路径必须拒绝"
for p in /data/config.json /data/admin.json /lib/music.php /lib/notify.php /deploy /admin/export.php; do
    c=$(code "$SITE_URL$p")
    [[ "$c" == "403" || "$c" == "404" ]] && ok "$p → $c" || bad "$p → $c（不该能访问）"
done

section "4. 音频"
MP3=$(ls "$SITE_ROOT"/assets/music/*.mp3 2>/dev/null | head -1)
if [[ -n "$MP3" ]]; then
    rel="/assets/music/$(basename "$MP3")"
    c=$(code "$SITE_URL$rel")
    [[ "$c" == "200" ]] && ok "$rel → 200" || bad "$rel → $c"
    c=$(curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-1023' "$SITE_URL$rel")
    [[ "$c" == "206" ]] && ok "Range 请求 → 206（可边下边播）" || bad "Range 请求 → $c（应为 206）"
else
    bad "assets/music/ 下没有音频文件"
fi

section "5. 压缩与缓存"
enc=$(curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' "$SITE_URL/assets/js/main.js" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-encoding"{print $2}')
[[ "$enc" == "gzip" ]] && ok "JS 启用 gzip" || bad "JS 未压缩（Content-Encoding=$enc）"
enc=$(curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' "$SITE_URL/assets/css/style.css" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-encoding"{print $2}')
[[ "$enc" == "gzip" ]] && ok "CSS 启用 gzip" || bad "CSS 未压缩（Content-Encoding=$enc）"
curl -s -o /dev/null -D - "$SITE_URL/assets/js/main.js" | tr -d '\r' | grep -qi 'cache-control:.*immutable' \
    && ok "静态资源带 immutable 长缓存" || bad "静态资源缺少长缓存头"

section "6. 构建一致性（partials / ?v=）"
if [[ -f "$BUILD" ]]; then
    if python3 "$BUILD" --site "$SITE_ROOT" --check >/tmp/smoke-build.log 2>&1; then
        ok "partials 与版本号均已同步"
    else
        bad "构建不一致：$(tail -1 /tmp/smoke-build.log)"
    fi
else
    bad "找不到 $BUILD"
fi

section "7. 新功能就绪"
for f in /assets/js/features.js; do
    c=$(code "$SITE_URL$f")
    [[ "$c" == "200" ]] && ok "$f → 200" || bad "$f → $c"
done
for k in searchBtn notifyBtn memorySection; do
    body "$SITE_URL/home.html" | grep -q "$k" && ok "首页含 $k" || bad "首页缺少 $k"
done
body "$SITE_URL/api/config.php" | grep -q "__SERVER_NOTIFY__" && ok "注入含 __SERVER_NOTIFY__" || bad "注入缺少 __SERVER_NOTIFY__"
# 后台页面未登录时只回登录页，按钮在文件里 —— 直接查源文件更可靠
grep -q "exportZipBtn" "$SITE_ROOT/admin/index.php" 2>/dev/null && ok "后台有导出按钮" || bad "后台缺少导出按钮"

section "8. 身份 / 心愿 / 胶囊 / 缩略图"
for f in /assets/js/identity.js /assets/js/wishes.js /assets/js/capsule-teaser.js; do
    c=$(code "$SITE_URL$f")
    [[ "$c" == "200" ]] && ok "$f → 200" || bad "$f → $c"
done
for f in api/identity.php api/wishes.php; do
    c=$(code "$SITE_URL/$f")
    # 未解锁时必须是 401/403 —— 身份与心愿都不许匿名读
    if [[ "$c" == "401" || "$c" == "403" ]]; then ok "/$f 匿名 → $c"; else bad "/$f 匿名 → $c（应为 401/403）"; fi
done
body "$SITE_URL/home.html" | grep -q "capsuleTeaser" && ok "首页含胶囊入口" || bad "首页缺少胶囊入口"
grep -q "identity.js" "$SITE_ROOT/home.html" 2>/dev/null && ok "页面加载 identity.js" || bad "页面缺少 identity.js"
grep -q "wishes.js" "$SITE_ROOT/letter.html" 2>/dev/null && ok "情书页加载 wishes.js" || bad "情书页缺少 wishes.js"
grep -q "histList" "$SITE_ROOT/admin/index.php" 2>/dev/null && ok "后台有版本历史面板" || bad "后台缺少版本历史"
grep -q "photo_order" "$SITE_ROOT/admin/api.php" 2>/dev/null && ok "后台有照片排序接口" || bad "缺少 photo_order"
[[ -d "$SITE_ROOT/data/history" || -d "$SITE_ROOT/data" ]] && ok "data/ 目录存在（历史快照落这里）" || bad "data/ 缺失"

if [[ $DEEP -eq 1 ]]; then
    section "9. 浏览器实测（chromium）"
    if ! command -v chromium >/dev/null 2>&1; then
        bad "没有 chromium，跳过（用 --deep 前先装）"
    else
        # 临时种一个门禁 Cookie 的入口页，跑完立刻删
        ENTRY="$SITE_ROOT/__smoke_enter.php"
        trap 'rm -f "$ENTRY"' EXIT
        cat > "$ENTRY" <<'PHP'
<?php
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/access.php';
if (love_gate_required() && !love_gate_ok()) love_gate_set();
header('Location: /home.html?musicdebug=1', true, 302);
PHP
        chmod 644 "$ENTRY"
        UD=$(mktemp -d)
        chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
            --autoplay-policy=no-user-gesture-required --enable-logging=stderr --v=0 \
            --user-data-dir="$UD" --virtual-time-budget=12000 --dump-dom \
            "$SITE_URL/__smoke_enter.php" >/tmp/smoke-dom.html 2>/tmp/smoke-err.log
        rm -rf "$UD"

        if grep -qiE 'uncaught|TypeError|ReferenceError|SyntaxError' /tmp/smoke-err.log; then
            bad "页面有 JS 报错：$(grep -aiE 'uncaught|TypeError|ReferenceError|SyntaxError' /tmp/smoke-err.log | head -1)"
        else
            ok "无 JS 报错"
        fi
        grep -q 'id="musicPlayer"' /tmp/smoke-dom.html && ok "播放器已渲染" || bad "播放器未渲染"
        grep -q 'role="slider"' /tmp/smoke-dom.html && ok "进度条具备 slider 语义" || bad "进度条缺少 slider 语义"
        grep -q 'aria-expanded' /tmp/smoke-dom.html && ok "列表键有 aria-expanded" || bad "列表键缺少 aria-expanded"
        t=$(grep -o 'track   : [^<]*' /tmp/smoke-dom.html | head -1)
        [[ -n "$t" ]] && ok "播放器状态：${t#track   : }" || bad "读不到播放器状态"
    fi
fi

printf '\n\033[1m结果：%d 通过，%d 失败\033[0m\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
