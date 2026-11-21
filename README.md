# 情侣网站 · 源代码

一个需要密码进入的双人私密站点：PHP 8 + 原生 JS，无框架、无数据库，数据落在 `data/*.json`。
基于 [qinzuoyong/love](https://github.com/qinzuoyong/love)（MIT）修改，见 `LICENSE`。

> **发布版说明**：本仓库只包含**源代码、部署配置与构建脚本**。
> `site/data/*.json`（配置 / 管理员 / 留言 / 情书）、`site/assets/img/uploads/`（照片）、
> `assets/music/`（音乐）、门禁密钥 `data/gate_secret` 均**不在仓库内**，由程序运行时生成；
> 上游源码镜像 `src/` 也未一并发布。
>
> 页面里的 `https://YOUR-SITE.example` 是**占位域名**，部署前替换成你自己的地址
> （涉及 `og:image` / `og:url`，8 个页面各一处）。
>
> 分享封面 `site/assets/img/og-cover.png` 含个人姓名，未随仓库发布；需要时自行放一张
> 同名 1200×630 图片即可，缺省不影响站点运行，只是社交分享没有预览图。

| 目录 | 是什么 |
|---|---|
| `site/` | 站点全部源代码：页面、脚本、样式、`api/`、`lib/`、后台 `admin/` |
| `deploy/` | Nginx 配置示例（含 gzip 与 `data/`、`lib/` 禁止直取） |
| `tools/` | `build.py`（同步 partials + 刷新 `?v=`）、`smoke.sh`（冒烟测试） |

> `data/config.json` 里存**明文解锁密码**，已被 `.gitignore` 排除，请勿提交。

---

## 协作流程（主机优先，每次改动都按这个顺序）

**唯一事实来源是主机上的 `/var/www/love`。本地仓库只做镜像与版本留痕。**

```
① 改：在主机上改并验证     改文件 → 看 nginx/php 日志 → 用浏览器/curl 验证
② 拉：主机 → 本地            ./scripts/sync-pull.sh  （只拉回改动过的文件）
③ 提交：本地 git commit      git add -A && git commit -m "..."
④ 回滚：需要时本地 → 主机     ./scripts/sync-up.sh（应急，平时不用）
```

**为什么改成主机优先**：上一轮是「本地改 → 推主机」，中间多了一次传输，而且本地 `site/` 一旦旧了，推上去就把线上内容（留言、照片、配置）冲掉。改在主机上、先从主机验证通过，再拉回来记账，链路最短、出错面最小。

> 唯一的例外是**只改内容**（名字、日期、解锁密码、照片、留言）：直接用 `…/admin/` 后台改，保存即生效，既不构建也不发布。

### ① 在主机上改

```bash
instabox exec lovehost -- 'sudo vim /var/www/love/assets/js/main.js'
```

改完立刻在主机上验证（不必等传输）：

```bash
# 语法
instabox exec lovehost -- 'php -l /var/www/love/api/config.php'
# 页面与接口
instabox exec lovehost -- 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/home.html'
instabox exec lovehost -- 'sudo tail -20 /var/log/nginx/love.error.log'
```

改了 `assets/js/*.js` 或 `assets/css/*.css` 之后**必须同步改 HTML 里的 `?v=` 版本号**，否则浏览器会继续用缓存里的旧文件：

```bash
md5sum /var/www/love/assets/js/main.js | cut -c1-8     # 取新值
sed -i 's/main.js?v=<旧值>/main.js?v=<新值>/g' /var/www/love/*.html
```

### ② 拉回本地

```bash
./scripts/sync-pull.sh assets/js/main.js home.html index.html   # 只拉指定文件
./scripts/sync-pull.sh --all                                   # 全量下拉（含 data/，慢）
```

脚本把文件打成一个小包再 `instabox pull`，避免为几十 KB 走十几次往返。

### ③ 构建与冒烟（改过页面/样式/脚本后必跑）

```bash
sudo python3 /data/love-build/build.py --site /var/www/love   # 同步 partials + 刷新 ?v=
sudo bash /data/love-build/smoke.sh                           # HTTP + 构建一致性
sudo bash /data/love-build/smoke.sh --deep                    # 再加一次真实浏览器检查
```

`build.py` 做两件事：把 `partials/{nav,footer}.html` 同步进 7 个页面（导航/页脚只有一份源），
以及重算所有 `assets/**/*.js|css` 的 `?v=<md5>`（不用再手工替换版本号）。

### ④ 提交

```bash
git add -A
git commit -m "fix: 音乐播放状态机"
```

### ④ 应急回滚（本地 → 主机）

```bash
./scripts/sync-up.sh
```

只覆盖代码，**不含 `data/` 与 `assets/img/uploads`**。仍有两条红线：

> ⚠️ 绝不能 `rsync --delete`：`dist/` 里没有 `data/`，`--delete` 会把线上数据删光。
> ⚠️ `build.py` 会用 `src/assets/` 覆盖 `assets/`，自定义的 `assets/music/` 需要单独备份/回传。

---

## 日常命令速查

| 场景 | 命令 |
|---|---|
| 主机被挂起、网站打不开 | `instabox resume lovehost` |
| 看站点是否在线 | `curl -I https://YOUR-SITE.example/` |
| 看 Nginx 错误 | `instabox exec lovehost -- sudo tail -20 /var/log/nginx/love.error.log` |
| 看 PHP 错误 | `instabox exec lovehost -- sudo tail -20 /var/log/php8.4-fpm.log` |
| 停掉公网访问 | `instabox port unpublish lovehost 3000` |
| 数据备份（不依赖本仓库） | 后台 →「备份与恢复」→ 下载 |

---

## 目录说明（`site/`）

```
site/
├─ index.html … achievements.html   8 个页面
├─ api/        config.php（注入配置）/ content.php / unlock.php / daily.php / compat.php
├─ admin/      index.php（后台 SPA）/ api.php（后台接口）/ export.php（一键导出 zip）/ install.php
├─ lib/        共享层：JSON 原子读写、会话、门禁、内容、每日一问、配置校验、通知条目、ZIP 打包
├─ data/       ★ 运行时数据（配置 / 管理员 / 留言 / 情书 / 胶囊 / 每日一问 / 默契回合）
├─ assets/
│  ├─ js/      config.js 默认配置、main.js 主逻辑（含音乐播放）、features.js 通知/搜索/回忆卡、gate.js 门禁…
│  ├─ css/     style.css（主题色在文件顶部 :root）
│  ├─ img/     照片（占位图 + uploads/ 上传目录）
│  └─ music/   背景音乐（后台上传的曲目 + 历史 music.dat，见下）
└─ photo.php   照片代理（校验解锁 Cookie 才给图）
```

## 背景音乐怎么换

首选后台「背景音乐」标签页上传并「设为当前」，见下文。手动换曲仍然可用：

1. 转码：`ffmpeg -i 源.mp3 -vn -b:a 64k -ac 1 -ar 44100 -map_metadata -1 music.dat`
2. 放到 `site/assets/music/music.dat`（主机上 `/var/www/love/assets/music/music.dat`）
3. **必须**把 `assets/js/main.js` 里的 `music.dat?v=N` 的版本号 +1，否则老访客 30 天还在听旧曲
4. 不要给 `.dat` 加 `AddType audio/mpeg`

> `music.dat` 现在是**没有后台曲目时**的回落项，优先级低于 `data/music.json` 里的当前曲目。
> 后台已有完整音乐管理（上传/查看/试听/改名/删除/设为当前），不必手动改文件。

---

## 已修复的问题

### 2026-11-19 · 设置解锁密码后，客户端输对密码也进不去

**现象**：后台设了「解锁页密码」，前台输入正确口令仍然被拒，接口返回
`403 这个请求不是从本站页面发出的`，页面只显示"密码不对"。

**根因**：`lib/store.php` 的 `love_origin_ok()` 用 `Origin` 的域名去比 `HTTP_HOST`。
本站在平台反向代理后面，边缘层把 `Host` 改写成 `127.0.0.1`，真实域名只在
`X-Forwarded-Host` 里 —— 两者永远不等，于是**每一次解锁都被当成跨站请求拒掉**。

**修法（两层，缺一不可）**：
1. `love_origin_ok()`：优先用 `X-Forwarded-Host`（多级代理取第一段），没有该头时行为不变；
2. Nginx：`map` 还原真实 Host 并 `fastcgi_param HTTP_HOST`，让 PHP 看到的环境是对的。

**验证**：公网 `POST /api/unlock.php` 正确密码 → `{"ok":true,"unlocked":true}`，
带 Cookie 访问 `/api/content.php` → 200；错误密码 → 401；`Origin: https://evil.example`
→ 仍然 403（CSRF 防护没有被削弱）。

### 2026-11-19 · 后台已设「当前曲目」，前台却没有声音

**现象**：后台音乐列表里已有两首、其中一首「用中」，进站一点声音都没有，喇叭图标是
静音态，页面上也没有「点一下播放」的提示。Nginx 日志里却能看到这台设备把整首 mp3
（4.7MB）完整下载了 —— 有流量、没声音、没报错。

**根因 1（主因）**：`love-music` 这个开关偏好写进了 **localStorage**。
之前只要在音乐播放时点过一次喇叭图标（哪怕是随手试一下），这台设备就被**永久**记成
`off`。之后进站 `tryStart()` 根本不会被调用：音频元素照样把整首曲子下完（`new Audio()`
自带 preload），却一次都不播，而且不报错、不提示。用户看到的就是"音乐坏了"。

**根因 2（让人看不出是关着的）**：静音态只把图标透明度从 1 调到 0.75，肉眼几乎无法
分辨，用户没法判断"这是被关了"还是"真的坏了"。

**次生问题**：每次进站都先对 mp3 发一次 HEAD 探测（8s 超时）。慢链路上探测超时会被
当成"没有 mp3"，页面直接退到内置合成旋律 —— 一次多余的往返换来一次静音。

**修法**：

1. 开关改用 `sessionStorage`：关掉只影响本次浏览（站内翻页仍保持关闭），关标签页/重开
   浏览器即恢复；并**一次性清掉**旧版本留在 localStorage 里的 `off`，用户不必手动清缓存；
2. 静音时给常驻提示「音乐已关闭，点右上角 🎵 开启」，点击按钮时收掉；
3. 有服务端曲目时**不再做 HEAD 探测**，直接进播放分支（曲子是后台写进 `music.json` 的，一定在）；
4. 缓冲中把「正在缓冲 N%…」写进提示（`waiting`/`stalled` + `buffered` 进度），让"在加载"
   和"坏了"能区分开；
5. 只有真正 `playing` 才收提示、点亮图标、停掉合成旋律（状态不再说谎）；
6. 新增排障开关：网址后加 `?musicdebug=1`，页面左下角显示 `src / server / audio(rs·ns·paused·ct·vol) / buffered / error / state / pref`。

**验证**（主机 Chromium 真实播放，非模拟）：

| 用例 | 结果 |
|---|---|
| 正常进站（允许自动播放） | `rs=4 paused=false ct` 从 0.1 连续推进到 11.7，`dur=193.6`，缓冲 193.6s 全满 |
| 旧 localStorage 残留 `love-music=off` | `pref: on`、`state: 在响` —— 旧开关被正确忽略 |
| sessionStorage 里 `love-music=off` | `pref: off`、`state: 停止`，并显示「音乐已关闭，点右上角 🎵 开启」 |
| 全站回归 | 8 个页面 200、`/api/config.php` 正常、mp3 `200 / 4744218B`、`php -l` 无错 |

> 排障提示：如果还是没声音，先在网址后加 `?musicdebug=1` 看一眼 ——
> `state: 等手势` 表示浏览器拦了自动播放（点一下页面即可）；
> `state: 启动中` 且 `buffered` 不涨表示在缓冲；`error` 非 0 表示解码失败；
> `pref: off` 就是被静音了（点一下喇叭图标）。

## 功能：背景音乐管理（2026-11-19 新增）

后台「背景音乐」标签页支持：

| 操作 | 说明 |
|---|---|
| 上传 | mp3 / m4a / aac / ogg / wav / flac，单个 ≤12MB，最多 30 首；文件名与大小自动记录 |
| 查看 | 列表显示标题、大小、上传日期、是否正在使用 |
| 试听 | 直接在后台播放，不用先启用 |
| 设为当前 / 取消 | 只有"当前"那首会被前台播放；取消后回落到 `music.dat` 或内置合成旋律 |
| 改名 | 行内编辑标题（不影响文件名） |
| 删除 | 记录与服务器文件一并删除 |

实现要点：

* 文件存 `assets/music/`，索引存 `data/music.json`（`{active, tracks[]}`），写操作走 `love_mutate()` 与其它数据共用同一把锁；
* 接口：`admin/api.php` 的 `music_list` / `music_upload` / `music_update` / `music_activate` / `music_delete`；
* 前台：`api/config.php` 注入 `window.__SERVER_MUSIC__`（**只在解锁后下发**），`assets/js/main.js` 优先播它；
* 上传做三重校验：扩展名白名单 → base64 长度预判（避免把 20MB 串读进内存）→ `finfo` 内容嗅探（挡住改名成 .mp3 的可执行文件）。

## 功能：边下边播 + 后台补缓存（2026-11-21）

**目标**：首播不等整首下完 —— 缓冲够了立刻出声；同时把整首存进本地，下次进站零下载。

实现（`assets/js/main.js`，Cache Storage，缓存名 `love-music-v1`）：

| 阶段 | 行为 |
|---|---|
| 查缓存 | 进站先 `cache.match(绝对URL)`（毫秒级，**不阻塞起播**），缓存键是带 `?v=<ts>` 的地址，换曲自动换键 |
| 命中 | 读 blob → `URL.createObjectURL()` → 直接播本地，零网络请求（实测 0.2s 出声） |
| 未命中 | 立刻把网络地址交给播放器，浏览器**边下边播**，缓冲够了就出声（不等整首） |
| 补缓存 | 等浏览器报 `canplaythrough`（认为能一路播完不停）后，才在后台 `fetch` 整首、校验长度、`cache.put` |
| 清理 | 写入成功后 `prune` 掉别的曲目，旧歌不占配额 |

选这个时机的理由：补缓存永远发生在播放已经顺畅之后，不跟播放抢带宽；
慢链路上哪怕一直补不完，也完全不影响这一遍听歌 —— 最坏情况就是"下次还要再下"。

**回退（任何一条都不能变成"没声音"）**：

| 情况 | 处理 |
|---|---|
| 非安全上下文（http 非 localhost）、隐私模式、策略禁用 → 没有 `caches` | 直接流式播放 |
| 缓存条目长度不符（被截断/被浏览器回收一半） | 删除该条目，这次流式播，下次重补 |
| 配额不足 / `cache.put` 抛错 | 播放不受影响，只是没存下 |
| 后台补缓存超时（180s） | 放弃补缓存，继续播 |
| 返回 HTML/XML/JSON（WAF 挑战页冒充音频） | 判为失败，不写缓存 |

**验证**（主机 Chromium 真实时间运行，页面每 0.5s 回传状态到服务端，非虚拟时钟）：

| 用例 | 结果 |
|---|---|
| 首次进站（空缓存） | t=1.0s 已 `在响`（`ct=0.4`）而 `cache: 后台补缓存 99%`；`first: 1.1s 出声`、`cacheAt: 1.9s 缓存完成` —— **出声早于缓存完成** |
| 二次进站（同一 profile） | `cache: 命中缓存（4633KB，未走网络）`、`first: 0.2s`、nginx **新增音乐请求 0** |
| 人工塞入 2KB 半截缓存 | 未采用该条目（否则时长/播放都会异常），重新补齐为 `已缓存 4633KB`，全程 `buffered 193.6s` 正常播放 |
| 非安全上下文（`http://172.17.0.1:3000`） | `cache: 不可用（浏览器不支持或非安全上下文）`，`first: 0.2s`，正常播放 |

> 排障：`?musicdebug=1` 面板里的 `cache` / `first` / `cacheAt` 三行就是缓存与首播耗时；
> 想强制重下，控制台执行 `caches.delete('love-music-v1')`。

## 功能：音乐播放器（2026-11-21）

右下角的圆形音乐按钮换成了胶囊播放器，点 ☰ 向上弹出播放列表。

| 控件 | 行为 |
|---|---|
| ⏮ / ⏭ | 上一首 / 下一首（随机模式下 ⏭ 随机挑一首） |
| ▶ / ⏸ | 播放暂停，图标随状态切换（内联 SVG，不用字符 —— ⏮/⏭/▶ 在部分系统会掉成方块或彩色 emoji） |
| 模式 | 面板右上角切换「顺序播放 / 单曲循环 / 随机播放」，记在 localStorage，下次进站沿用 |
| 列表 | 点曲目直接切歌，当前曲目高亮并标 ♪；右侧显示文件大小 |
| 进度条 | 显示当前位置并支持点击跳转，两侧是 0:00 / 3:13 |

行为细节：

* **顺序播放**：列表播完就停下，不自动绕回第一首；想一直循环请选「单曲循环」。
* **单曲循环**：`ended` 时回到 0 秒重播。刻意不用 `loop` 属性 —— 它会和「下一首」抢 `ended`。
* **随机播放**：播完/点下一首都随机挑一首，不会连着两次挑到同一首。
* 换歌只换 `audio.src`，不重建 `<audio>`：重建会丢监听，也会让 iOS 上的解锁状态失效。
* 每首单独记进度（`love-music-pos-<id>`），切回来接着听；进站默认接着上次那首。
* 面板外点击或按 Esc 收起；面板打开时右下角「返回顶部」自动隐藏，避免被压住。
* 没有上传曲目时不显示列表、切歌键置灰，回落内置旋律 —— 与之前行为一致。

数据来源：`api/config.php` 注入的 `window.__SERVER_MUSIC__` 现在带完整 `tracks[]`
（`lib/music.php` 的 `love_music_view()`），仍然**只在解锁后**下发。曲目项只有标题、大小和
播放地址 —— 音频文件本来就是公开可取的（文件名带随机串），不含隐私。

排障：`?musicdebug=1` 时会额外挂 `window.__lovePlayer`（`info/next/prev/mode/seekEnd`），
远程排查与自动化验证都用它驱动，正常访问（不带该参数）时不存在。

## 行为：每次打开随机挑一首（2026-11-21）

以前是「接着上次那首」，现在**每次打开或刷新都从列表里随机选一首**，从 0 秒开始播。

| 场景 | 行为 |
|---|---|
| 打开/刷新（列表 ≥2 首） | 在「除上次那首之外」的曲目里随机——不会连着几次都是同一首 |
| 只有 1 首 | 只能放它（没有可换的） |
| 列表为空 / 注入失败（`__SERVER_MUSIC__` 缺失） | 回落内置旋律；切歌键置灰，但**列表仍可打开**，显示「还没有上传曲目，正在播放内置旋律」 |
| 某一首加载失败（文件丢了 / 解码失败） | 自动换一首没试过的；整个列表都试过才退回内置旋律 |
| 随机来回切歌 | 缓存改成保留最近 6 首（原来只留 1 首，切回去就得重下 4~6MB） |

细节：

* 「上次播的那首」记在 `localStorage` 的 `love-track-id`，只用于随机时避开，不再用来续播。
* 因为随机起播，**跨页面的播放进度记忆被移除了**（随机到一首歌却从第 2 分钟开始会很怪）。
  同一页面里暂停/继续不受影响。
* 顺带修掉一个潜伏 bug：`toast()` 里的 `toastTimer` 原来是 `let`，而空列表时初始化阶段就会
  调 `toast()`，触发 TDZ 报错 —— 整个脚本后半段（包括按钮绑定）都不会执行，表现为
  「列表点不开、切歌没反应」。改成 `var` 后不再有这个问题。

## 工程化：模板、版本号、冒烟（2026-11-21）

| 能力 | 文件 | 说明 |
|---|---|---|
| 页面片段 | `site/partials/{nav,footer}.html` | 导航与页脚的唯一来源；7 个页面由构建脚本注入，**不要直接改页面里的这两块** |
| 构建 | `tools/build.py` | `--init` 首次抽取（已完成）；平时直接跑；`--check` 只检查不写（冒烟用） |
| 版本号 | 同上 | 自动把 `assets/**/*.js|css` 的 `?v=` 改成文件 md5 前 8 位，不会再出现"改了 css 忘了改 hash" |
| 冒烟 | `tools/smoke.sh` | 9 个页面 200、接口注入、私有路径 403、音频 Range、gzip/缓存头、构建一致性；`--deep` 再用 chromium 跑一次真实页面 |

主机上的位置：`/data/love-build/{build.py,smoke.sh}`（构建要写 `/var/www/love`，用 `sudo` 跑）。

一次典型的改动闭环：

```bash
sudo vim /var/www/love/assets/js/main.js
sudo python3 /data/love-build/build.py --site /var/www/love
sudo bash /data/love-build/smoke.sh --deep
# 全绿 → ./scripts/sync-pull.sh ... → git commit
```

## 五件改进（2026-11-21）

1. **开启 gzip**：Debian 默认只压 HTML，`gzip_types` 是注释状态。补上后主脚本 58.8KB → 20.7KB、
   样式 70.7KB → 20.3KB，首页 JS+CSS 285KB → 105KB。配置见 `deploy/nginx-gzip.conf.example`。
2. **无障碍**：`toast` 加 `role=status` + `aria-live`；播放器进度条 `role=slider` + `tabindex` + ←/→/Home/End
   键盘操作 + `aria-valuenow`；列表键 `aria-expanded`/`aria-controls`；面板 `role=dialog`；
   播放按钮动态 `aria-label`；6 个二级页补 `sr-only` 的 h1（原来从 h2 起步，标题层级断裂）。
3. **首屏**：底部 8 个脚本加 `defer`（不再 parser-blocking）；样式表挪到 head 末尾，
   让 `api/config.php` 的往返与 CSS 下载并行而不是串行。head 里保留的 4 个脚本是主题防闪、
   配置注入与门禁跳转所需，**不能** defer（后面有内联脚本依赖它们）。
4. **模板化**：导航/页脚抽成 partial，7 个页面由 `build.py` 生成；版本号同时自动化。
5. **分享与冒烟**：补 `og:image`（1200×630 分享卡）、`twitter:card`、favicon；把回归固化成 `tools/smoke.sh`
   （本次 28 项全绿）。

## 四个新功能（2026-11-21）

| 功能 | 入口 | 怎么实现的 |
|---|---|---|
| **未读通知中心** | 导航栏 🔔 | `lib/notify.php` 只输出「候选条目 + 稳定 id」（新照片 / 胶囊到期 / 对方答了每日一问 / 新情书，最多 30 条），经 `__SERVER_NOTIFY__` 注入；**已读按设备记在 localStorage**，服务端零新增状态。首次访问把所有现有条目记为已读，避免一进站就"99+"；停留期间每 60 秒静默刷新一次。 |
| **一键导出（含照片）** | 后台「备份与恢复」 | `admin/export.php` 流式下载 zip：`data/*.json` + `photos/` 原图 + `README.txt` 恢复说明。主机没装 ZipArchive（`php -m` 只有 zlib/gd），所以 `lib/zip.php` 自己拼 ZIP 结构（store 不压缩），`zipfile.testzip()` 校验通过。**不含** `assets/music`（体积大）与 `data/gate_secret`（外带即可伪造解锁 Cookie）。 |
| **全站搜索** | 导航栏 🔍 / 按 `/` 或 `⌘K` | 纯前端索引：情书、留言、时光轴、相册说明、纪念日、心愿瓶；结果带类型标签与命中高亮，点结果跳到对应页面。不发请求。 |
| **往年今天** | 首页（有命中才出现） | 按「月-日」匹配往年的照片 / 情书 / 时光轴 / 胶囊，取最近 3 条；没有命中就整块隐藏，不占版面。 |

两个实现上的坑，记一下免得下次再踩：

* `CONFIG` 是 `config.js` 里的**顶层 const**，只生成全局词法绑定，**不是** `window.CONFIG`。
  新脚本要用 `typeof CONFIG !== "undefined" ? CONFIG : window.CONFIG` 取，否则永远拿到 `{}`。
* 通知里的"新"指"本设备没见过这个 id"，不是服务端时间比较 —— 两台设备各自算各自的，
  换手机不会把旧通知重新标成未读。

## 五个功能（2026-11-21 晚）

### 1. 双人身份（认领设备 / 昵称头像）

导航菜单最下面多一项「👤 我是谁」。点开选一个人 → 这台设备就归 TA 了，
可以顺手起名、挑头像。之后留言、照片、胶囊旁边会自动出现作者小徽章。

* 身份凭据只来自服务端 HttpOnly Cookie 的 `deviceId`，前端不持有、也不提交；
  认领只是把"这台设备的 id"记到 `data/identity.json` 的 a / b 名下。
* 一个人可以有多台设备（手机 + 电脑）：已认领的槽位再点「这台也是我」即可，
  每人上限 8 台。
* 只能改自己（或还没人认领的）那一位的名字 —— 否则谁都能把对方改名。
* 未认领时进站会提示一次「点菜单里的『我是谁』」。

### 2. 心愿瓶状态流转（想要 → 在做 → 已实现）

心愿卡右上角是状态徽章，卡片里三个小按钮直接切换；顶部有进度条
（已实现 N / 总数）与「全部 / 想要 / 在做 / 已实现」筛选，还能在页面上
直接「＋ 许个愿」。

* 文案仍来自 config（后台"情书与心愿"照旧编辑），**状态**存
  `data/wishes.json`：`states`（按 title+text 算出的稳定键）+ `custom`（页面上新增的）。
  状态键由前端算 —— 默认心愿只写在 `config.js` 里，服务端读不到那批文案。
* 排序：在做 → 想要 → 已实现，同组内保持原顺序。
* 删除只对"页面上新增的心愿"开放，config 里的归后台管。

### 3. 内容版本历史（后台）

后台「备份与恢复」多了"版本历史"：选文件 → 列出快照（时间/大小）→ 预览 / 恢复。

* 每次写入前把**旧内容**存到 `data/history/<文件>/`，同一文件 60 秒内只留一份，
  每个文件最多 15 份、单份上限 2MB（免费主机磁盘有限）。
* 恢复前会先把**当前版本**再存一份 —— 恢复错了还能退回来。
* `security.json` 不记录：它存的是锁定状态，回滚等于让暴力破解多试几轮。
* 失败一律静默：历史是额外保险，绝不能让正常写入失败。

### 4. 相册：缩略图 + 批量上传 + 拖动排序

* **缩略图**：列表改走 `photo.php?f=…&w=560`，服务端用 gd 现生成、缓存到
  `data/thumbs/`（实测 79KB → 5.7KB）。灯箱仍用原图。没有 gd / 动图 / 原图本来就窄
  都自动退回原图 —— 只是没省流量，不会看不到图。
* **批量上传**：后台一次可选多张，改成并发 2 的队列（一条在传、一条在压缩），
  并显示「上传中 3/20」。
* **拖动排序**：后台照片列表每行有 ⠿ 手柄（HTML5 拖放），触屏用 ↑ / ↓ 按钮；
  松手即调 `photo_order` 保存。列表自上而下就是相册页的显示顺序。

### 5. 胶囊入口 + 到期提醒

首页 hero 下面多了一条紧凑横条：
到期的显示「有 N 封可以打开了」+ 直达按钮（并在进站时 toast 提醒一次）；
没到期的显示「下一封还有 X 天」；一封都没有就整块隐藏。

* 提醒按胶囊的稳定键记在 localStorage，同一封不会反复弹。

### 实现备忘（下次改前先看）

* `content_view()` 现在给每条内容补 `author`（a/b/空）；前端用
  `[data-author]` 标记，`identity.js` 的 MutationObserver 自动往里插徽章 ——
  所以动态渲染的内容不需要自己画徽章，只要带属性。
* `photo.php` 在**站点根目录**，缩略图缓存目录是 `__DIR__ . '/data/thumbs'`
  （不是 `dirname(__DIR__)`，那是给 `lib/` 下的文件用的）。
* 心愿的乐观更新必须写进**数据源**（`remote.states` / `remote.custom`）再 render：
  `items()` 每次重建对象，只改传进来的引用会被下一次渲染抹掉。

## 历史

| 日期 | 内容 |
|---|---|
| 2026-11-19 | 初始备份（site + src）；修复解锁密码无法登录；新增后台音乐管理；补 `deploy/` Nginx 配置 |
| 2026-11-19 | 协作流程改为**主机优先**（主机改 → 验证 → `sync-pull.sh` 拉回 → 提交）；修复"后台设了当前曲目却没声音"（静音开关持久化 + HEAD 探测误判） |
| 2026-11-21 | 背景音乐改为**边下边播 + 后台补缓存**：缓冲够了就出声（实测出声 1.1s / 缓存完成 1.9s），canplaythrough 之后再把整首补进 Cache Storage，二次进站零请求 |
| 2026-11-21 | 播放按钮升级为**完整播放器**：上一首/下一首、顺序·单曲·随机、可展开播放列表、进度条跳转；`__SERVER_MUSIC__` 增加 `tracks[]` |
| 2026-11-21 | 进站改为**随机挑一首**（排除上次那首）；空列表/加载失败有明确回退；修 `toastTimer` 的 TDZ；缓存保留最近 6 首 |
| 2026-11-21 | 工程化五项：gzip、无障碍语义、脚本 defer、页面模板化+版本号自动化、og 分享图+冒烟脚本 |
| 2026-11-21 | 四个新功能：未读通知中心、一键导出（含照片的 zip）、全站搜索、往年今天回忆卡 |
| 2026-11-21 | 五个新功能：双人身份认领（昵称头像 + 作者徽章）、心愿瓶状态流转、内容版本历史、相册缩略图/批量上传/拖动排序、首页胶囊入口与到期提醒 |
