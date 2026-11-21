/* ============================================================
   情侣网站 · 通用脚本
   负责: 导航 / 品牌名 / 飘心背景 / 音乐盒 / 滚动动画 /
         返回顶部 / Toast / 彩带 / 解锁页花瓣
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 视图生命周期 ----------
     本文件属**外壳级**：站内切页时它是"换视图"而不是"换文档"，所以本文件只跑一次，
     它建的监听/定时器要活过整个会话。因此外壳自己的注册一律走 LC.shell() 显式豁免，
     绝不能被视图账本清掉（清了会出现"提示还在、点了没反应"这类极难定位的 bug）；
     页面脚本则走 LC.on/every 登记、切页时统一清理。 */
  const LC = window.LoveLifecycle || null;
  function shellOn(target, type, fn, opts) {
    if (LC && LC.shell) LC.shell(function () { target.addEventListener(type, fn, opts); });
    else target.addEventListener(type, fn, opts);
  }
  function shellEvery(fn, ms) {
    if (LC && LC.shell) return LC.shell(function () { return setInterval(fn, ms); });
    return setInterval(fn, ms);
  }

  /* ---------- 品牌名 & 页面标题 ---------- */
  /* 这两个抽成函数：站内切页换视图后，新视图里的 [data-brand] 与 #heroNames
     需要重新回填，而外壳本身只跑一次（见 shell.js 的 loveOnViewMounted）。 */
  function loveBrandFill() {
    document.querySelectorAll("[data-brand]").forEach((el) => {
      /* 导航/页脚是站名位（data-brand-home），其余一律「一二 ♥ 布布」girl 在前 */
      el.textContent = el.hasAttribute("data-brand-home")
        ? CONFIG.names.girl + " & " + CONFIG.names.boy + "的小家"
        : CONFIG.names.girl + " ♥ " + CONFIG.names.boy;
    });
    const heroNames = document.getElementById("heroNames");
    if (heroNames) {
      const esc = window.escHtml || ((v) => String(v === null || v === undefined ? "" : v));
      heroNames.innerHTML =
        esc(CONFIG.names.girl) + ' <span class="amp">♥</span> ' + esc(CONFIG.names.boy);
    }
  }
  // 浏览器标签页标题带上名字(便于多标签识别, 改名后自动跟着变)
  function loveSetTitle(pageTitle) {
    document.title = CONFIG.names.girl + " ♥ " + CONFIG.names.boy + " · " + pageTitle;
  }

  /* ---------- HTML 里的占位名解析 ----------
     静态页面里凡是"某个人的名字"，只写**引用**：占位名 待定A / 待定B。
     解析成当前名字这一步不能省 —— 写死的真名在后台改名之后就变成不同步的
     死文本（letter.html 的署名示例、各页文案都是这条口径）。

     覆盖文本节点与 placeholder/title/aria-label/alt 四类属性；script / style /
     textarea / noscript 内部一律不动（那是代码，或用户正在编辑的内容）。
     `input.value` 属性也刻意不碰：页面上它常常是"用户刚敲进去的字"，
     覆盖掉等于吞掉输入。 */
  const NAME_REF_ATTRS = ["placeholder", "title", "aria-label", "alt"];
  function loveNameFill(root) {
    const resolve = window.loveResolveNames;
    if (!resolve) return;                       // 没加载 config.js（如后台页）就什么也不做
    const scope = (root && root.nodeType === 1) ? root : document;

    const fillAttrs = (el) => {
      NAME_REF_ATTRS.forEach((attr) => {
        if (!el.hasAttribute(attr)) return;
        const v = el.getAttribute(attr);
        const n = resolve(v);
        if (n !== v) el.setAttribute(attr, n);
      });
    };
    if (scope.hasAttribute) fillAttrs(scope);
    scope.querySelectorAll(NAME_REF_ATTRS.map((a) => "[" + a + "]").join(",")).forEach(fillAttrs);

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "NOSCRIPT") {
          return NodeFilter.FILTER_REJECT;
        }
        // 只收真正含占位名的节点：绝大多数节点连一次 substring 都不用做
        return n.nodeValue && n.nodeValue.indexOf("待定") !== -1
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    /* 先收集再改：TreeWalker 在遍历中途改 nodeValue 本身是安全的，但收集一次
       之后的写法更不容易在将来被"顺手改了上面这段"踩到。 */
    const hit = [];
    while (walker.nextNode()) hit.push(walker.currentNode);
    hit.forEach((n) => {
      const nv = resolve(n.nodeValue);
      if (nv !== n.nodeValue) n.nodeValue = nv;
    });
  }
  window.loveNameFill = loveNameFill;

  loveBrandFill();
  loveNameFill();
  loveSetTitle(document.title);

  /* ---------- 无障碍：跟随系统的"减弱动态效果" ----------
     开了就停掉飘心/光标爱心这类持续动画，打字机直接出全文（见各页脚本）。 */
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  window.__loveReduceMotion = reduceMotion;

  /* ---------- 高分屏适配 ----------
     给 canvas 设 width/height 时乘上 devicePixelRatio，并用 setTransform 把
     绘制坐标系还原成 CSS 像素 —— 这样脚本里继续按 innerWidth/innerHeight
     书写坐标即可，而在 DPR>1 的手机上不再发虚。
     注意：给 canvas.width 赋值会重置 2D 上下文状态，所以每次都要重新设变换。 */
  function fitCanvas(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);   // 上限 2：再高只是徒增开销
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  window.loveFitCanvas = fitCanvas;

  /* ---------- 顶部滚动进度条（transform: scaleX，走合成层） ---------- */
  let scrollBar = null;
  if (!reduceMotion) {
    scrollBar = document.createElement("div");
    scrollBar.className = "scroll-bar";
    scrollBar.setAttribute("aria-hidden", "true");
    document.body.appendChild(scrollBar);
  }

  /* ---------- 导航: 滚动阴影 / 高亮当前页 / 移动端菜单 ---------- */
  const nav = document.getElementById("nav");
  const topBtn = document.getElementById("topBtn");

  function onScroll() {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 8);
    if (topBtn) topBtn.classList.toggle("show", window.scrollY > 420);
    if (scrollBar) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      scrollBar.style.transform = "scaleX(" + p + ")";
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (topBtn) {
    topBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  // 当前页高亮（body 上的 data-page 与导航链接的 href 匹配）
  /* 抽成函数：外壳的导航栏在切页后**不会重建**，所以必须先把上一页的 active
     摘干净再高亮新的 —— 直接沿用"每次都是新文档"的旧写法会累积多个高亮。 */
  function loveNavHighlight() {
    const page = document.body.dataset.page || "";
    document.querySelectorAll(".nav-links a").forEach((a) => {
      const on = a.getAttribute("href") === page;
      a.classList.toggle("active", on);
      /* 读屏用户拿不到"我在哪一页"这条信息（原来只有 .active 这个纯视觉类）；
         aria-current 是这件事的标准表达（第七轮 S15-05）。 */
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }
  loveNavHighlight();

  const navToggle = document.getElementById("navToggle");
  const navLinks = document.querySelector(".nav-links");
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => navLinks.classList.toggle("open"));
    navLinks.addEventListener("click", (e) => {
      if (e.target.tagName === "A") navLinks.classList.remove("open");
    });
  }

  /* ---------- 动画循环(带降级: rAF 存在但不触发时自动切 setTimeout) ---------- */
  let animMode = null; // null=未探测 / "raf" / "timeout"
  function animLoop(cb) {
    const drive = () => cb(Date.now());
    if (animMode === "timeout") { setTimeout(drive, 33); return; }
    if (animMode === "raf") { requestAnimationFrame(drive); return; }
    // 首次调用: 探测 rAF 是否真的会回调
    if (typeof requestAnimationFrame !== "function") {
      animMode = "timeout";
      drive();
      return;
    }
    let fired = false;
    const rafId = requestAnimationFrame(() => { fired = true; animMode = "raf"; drive(); });
    setTimeout(() => {
      if (!fired) {
        animMode = "timeout";
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
        drive();
      }
    }, 150);
  }
  window.animLoop = animLoop; // 供 progress.js 等外部脚本复用

  /* ---------- 背景飘心 ---------- */
  function createHeartsCanvas() {
    const canvas = document.createElement("canvas");
    canvas.id = "heartsCanvas";
    document.body.prepend(canvas);
    const ctx = canvas.getContext("2d");
    let W, H, hearts = [], running = true;
    /* 代次令牌（R5-10）：页面隐藏时已经排进队列、但还没执行的那条 rAF 回调**不会**
       被浏览器丢弃 —— 重新可见时它会和 visibilitychange 里新排的一条并存，于是每
       切走再回来就多出一条链（2→3→4…），CPU/耗电随链数线性增长。
       每条链建立时领一个代次；回调发现自己的代次不是当前代次，就只收尾、不续链。 */
    let loopGen = 0;

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      fitCanvas(canvas, W, H);
    }
    resize();
    window.addEventListener("resize", resize);

    const MAX = reduceMotion ? 0 : (window.innerWidth < 640 ? 14 : 22);
    function spawn(force) {
      if (hearts.length < MAX && (force || Math.random() < 0.06)) {
        hearts.push({
          x: Math.random() * W,
          y: H + 30,
          r: 6 + Math.random() * 14,
          vy: 0.35 + Math.random() * 0.8,
          sway: 0.4 + Math.random() * 0.8,
          phase: Math.random() * Math.PI * 2,
          alpha: 0.12 + Math.random() * 0.2,
          hue: Math.random() < 0.75 ? 340 : 25,  // 粉 / 浅棕
        });
      }
    }

    /* phase 用每颗心自己的随机相位：早先这里读的是全局 heart_phase（其实存的是
       帧时间戳），于是变成 sin(ts*0.001 + ts) —— 每帧都在跳，视觉上是左右高频
       抖动；而 spawn() 里生成的 h.phase 从来没被读过。 */
    function drawHeart(x, y, r, t, hue, alpha, phase) {
      ctx.save();
      ctx.translate(x + Math.sin(t * 0.001 + phase) * 14, y);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "hsl(" + hue + ", 75%, 78%)";
      ctx.beginPath();
      ctx.moveTo(0, r * 0.32);
      ctx.bezierCurveTo(-r, -r * 0.35, -r * 0.45, -r, 0, -r * 0.28);
      ctx.bezierCurveTo(r * 0.45, -r, r, -r * 0.35, 0, r * 0.32);
      ctx.fill();
      ctx.restore();
    }

    function frame(ts, gen) {
      if (!running || gen !== loopGen) return;   // 已隐藏，或是一条陈旧链 → 到此为止
      ctx.clearRect(0, 0, W, H);
      spawn(false);
      hearts = hearts.filter((h) => h.y > -60);
      hearts.forEach((h) => {
        h.y -= h.vy;
        drawHeart(h.x, h.y, h.r, ts, h.hue, h.alpha, h.phase);
      });
      animLoop((t) => frame(t, gen));            // 续的是同一条链 → 沿用同一个代次
    }
    function startHeartsLoop() {
      const gen = ++loopGen;                     // 作废所有在途链
      animLoop((t) => frame(t, gen));
    }
    // 首屏先铺一批
    for (let i = 0; i < MAX; i++) spawn(true);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { running = false; loopGen++; }
      else if (!running) { running = true; startHeartsLoop(); }
    });
    startHeartsLoop();
  }

  /* ---------- 音乐盒(WebAudio 合成, 无需音频文件) ----------
     默认播放一段轻音乐盒旋律; 若存在 assets/music/music.dat
     则优先播放你的专属音乐(把音频命名为 music.dat 放进 assets/music/ 即可) */
  const SynthMusic = {
    ctx: null, master: null, delay: null, timer: null,
    playing: false, step: 0, nextTime: 0,

    // 简谱: [音名, 时值(拍)], 每 4 拍一个小节, 共 4 小节
    melody: [
      ["C4", 1], ["E4", 1], ["G4", 1], ["B4", 1],
      ["C5", 2], ["B4", 1], ["G4", 1],
      ["A4", 1], ["F4", 1], ["A4", 1], ["C5", 1],
      ["D5", 2], ["C5", 1], ["A4", 1],
      ["G4", 1], ["E4", 1], ["G4", 1], ["B4", 1],
      ["A4", 2], ["F4", 1], ["A4", 1],
      ["G4", 2], ["E4", 1], ["C4", 1], ["D4", 2], ["E4", 2],
    ],
    // 低音伴奏(每小节一个根音)
    bass: ["C3", "F3", "G3", "C3"],

    freq(name) {
      const notes = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
      const m = name.match(/^([A-G])(\d)$/);
      const n = notes[m[1]] + (parseInt(m[2], 10) + 1) * 12;
      return 440 * Math.pow(2, (n - 69) / 12);
    },

    note(f, t, dur, vol, type) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || "triangle";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(this.delay);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    },

    schedule() {
      while (this.nextTime < this.ctx.currentTime + 0.5) {
        const beat = 0.36;                 // 每拍时长
        const step = this.step;
        const total = this.melody.length;
        // 旋律
        const [name, len] = this.melody[step % total];
        this.note(this.freq(name), this.nextTime, beat * len * 0.92, 0.16);
        // 每小节低音
        if (step % 16 === 0) {
          const bar = (step / 16) | 0;
          this.note(this.freq(this.bass[bar % 4]), this.nextTime, beat * 15.5, 0.10, "sine");
        }
        this.nextTime += beat * len;
        this.step++;
      }
    },

    /* 返回"是否真的响起来了"（R5-16a）：调用方据此决定要不要点亮"在响"。
       AudioContext 可能不存在、构造可能被策略拒绝、resume() 可能同步抛 —— 旧实现把
       这几条都当成起播成功，于是图标亮着、实际一点声音都没有（与 mp3 那条路上
       fallbackSynth 的处理是同一族）。resume() 的**异步**拒绝在这里无法同步判定，
       只吞掉它以免变成未处理的拒绝。 */
    start() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) { toast("当前浏览器不支持音频"); return false; }
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.9;
          this.delay = this.ctx.createDelay();
          this.delay.delayTime.value = 0.28;
          const fb = this.ctx.createGain();
          fb.gain.value = 0.32;
          const wet = this.ctx.createGain();
          wet.gain.value = 0.35;
          this.delay.connect(fb);
          fb.connect(this.delay);
          this.delay.connect(wet);
          wet.connect(this.master);
          this.master.connect(this.ctx.destination);
        }
        const res = this.ctx.resume();
        if (res && typeof res.catch === "function") res.catch(function () {});
        this.step = 0;
        this.nextTime = this.ctx.currentTime + 0.1;
        this.timer = setInterval(() => this.schedule(), 120);
        this.playing = true;
        return true;
      } catch (e) {
        // 起不来就如实收场：不留下"在响"的状态，也不留下还在跑的调度器
        this.playing = false;
        clearInterval(this.timer);
        this.timer = null;
        return false;
      }
    },
    stop() {
      clearInterval(this.timer);
      this.timer = null;
      if (this.ctx) {
        this.ctx.suspend();
      }
      this.playing = false;
    },
    toggle() {
      if (this.playing) this.stop();
      else this.start();
    },
  };

  // ---------- 音乐播放器 ----------
  /* 一个 audio 元素负责全部曲目：换歌只换 src，不重建元素 ——
     重建会丢掉已绑定的监听，也会让 iOS 上的"解锁"状态失效。
     三件事分开：
       ① 播哪首：TRACKS + trackIndex + playMode
       ② 怎么出声：命中缓存播 blob，否则直接播网络地址（边下边播）
       ③ 界面：右下角胶囊 + 列表面板，只读状态、不发号施令
     没有后台曲目、或音频起不来时，仍然回落到内置合成旋律。 */

  const SRV_MUSIC = (typeof window !== "undefined" && window.__SERVER_MUSIC__) || null;
  const TRACKS = (SRV_MUSIC && Object.prototype.toString.call(SRV_MUSIC.tracks) === "[object Array]")
    ? SRV_MUSIC.tracks.filter(function (t) { return t && t.url; })
    : [];
  const HAS_TRACKS = TRACKS.length > 0;

  const PREF_KEY = "love-music";          // "on"/"off"，只记本会话（见下方注释）
  const MODE_KEY = "love-play-mode";      // order / single / shuffle
  const INDEX_KEY = "love-track-id";      // 上次播的那一首（只用于随机时避开它）
  const PLAY_SETTLE_TIMEOUT_MS = 12000;

  const MODE_ORDER = ["order", "single", "shuffle"];
  const MODE_LABEL = { order: "顺序播放", single: "单曲循环", shuffle: "随机播放" };

  let playMode = "order";
  let trackIndex = 0;
  let audioEl = null;
  let usingMp3 = false;
  let audioFail = false;      // 音频实际加载失败（服务器返回的可能是 WAF 挑战页）
  let musicPlaying = false;
  let starting = false;       // 一次启动流程还在进行中（play() 的 promise 还没落地）
  let playTimer = null;       // play() 迟迟不落地的看门狗
  let gestureSeen = false;    // 这次启动是否来自用户操作
  let musicPreparing = false; // 正在查缓存（毫秒级）
  let musicCacheHit = false;  // 这次是不是用缓存 blob 播的（是就不用再补）
  let musicCacheInfo = "未开始";
  let musicFirstSoundAt = 0;  // 首次出声时刻（ms，排障用）
  let musicCacheDoneAt = 0;   // 后台补缓存完成时刻（ms，排障用）
  let warmedId = "";          // 已补过缓存的曲目 id，避免同一首反复补
  let triedFail = 0;          // 本次进站连续加载失败的次数（防止全挂时无限重试）

  /* ---------- 音乐本地缓存（Cache Storage） ----------
     策略：**边下边播 + 后台补缓存**。
       1) 换歌先查缓存：命中就用本地 blob 播（零网络，最快）；
       2) 没命中就直接播网络地址 —— 交给浏览器边下边播，缓冲够了立刻出声；
       3) 等浏览器报 canplaythrough（认为能一路播完不用停）之后，再用空闲带宽
          把整首补进 Cache Storage，下次进站就又走 1)。
     补缓存永远发生在播放已经顺畅之后，不跟播放抢带宽；慢链路上哪怕一直补不完，
     也不影响这一遍听歌，最坏是"下次还要再下"。

     为什么用 Cache Storage 而不是 IndexedDB：天然按 URL 去重，配额与回收跟浏览器
     HTTP 缓存一套机制；读取是流式的，不用把几 MB 的 base64 塞进 IndexedDB。
     失败一律不影响播放：非安全上下文/隐私模式没有 caches；配额不足只是没存下；
     长度对不上就丢弃重来，绝不把半首歌当成缓存命中。 */
  const MUSIC_CACHE_NAME = "love-music-v1";
  const MUSIC_CACHE_FILL_TIMEOUT_MS = 180000;

  function musicCacheAvailable() {
    return (typeof caches !== "undefined" && caches && typeof caches.open === "function"
            && typeof fetch === "function" && typeof URL === "function");
  }

  /* 最多留几首：随机播放会来回切歌，只留"当前这一首"等于每次切回去都重下 4~6MB。
     6 首约 30MB 以内，对配额友好，也够覆盖一个来回。 */
  const MUSIC_CACHE_MAX = 6;

  /* 超出上限时从最旧的开始删，当前这首永远保留 */
  function loveMusicPrune(cache, keep) {
    try {
      if (!cache.keys) return;
      cache.keys().then(function (reqs) {
        var extra = reqs.length - MUSIC_CACHE_MAX;
        if (extra <= 0) return;
        /* keys() 按写入顺序返回 —— 前面的就是最久没写的 */
        for (var i = 0; i < reqs.length && extra > 0; i++) {
          if (reqs[i].url === keep) continue;
          try { cache.delete(reqs[i]); } catch (e) {}
          extra--;
        }
      }).catch(function () {});
    } catch (e) {}
  }

  /* 只查缓存，不下载：命中给 blob 地址，未命中给 null（立刻返回，不阻塞起播） */
  function loveMusicCacheLookup(url) {
    return new Promise(function (resolve) {
      if (!musicCacheAvailable() || !url) {
        musicCacheInfo = "不可用（浏览器不支持或非安全上下文）";
        resolve(null);
        return;
      }
      var abs;
      try { abs = new URL(url, location.href).href; }
      catch (e) { musicCacheInfo = "地址解析失败"; resolve(null); return; }

      musicCacheInfo = "读取缓存";
      caches.open(MUSIC_CACHE_NAME).then(function (cache) {
        return cache.match(abs).then(function (hit) {
          if (!hit) { musicCacheInfo = "未命中（边下边播）"; resolve(null); return; }
          return hit.blob().then(function (b) {
            var len = parseInt(hit.headers.get("content-length") || "0", 10);
            /* 条目还在但字节数对不上 = 上次写到一半（或被浏览器回收了一部分）：
               删掉，这次直接流式播。拿半首歌去播的表现是"放到一半突然结束"。 */
            if (!b || !b.size || (len && b.size !== len)) {
              return cache.delete(abs).then(function () {
                musicCacheInfo = "缓存不完整，已丢弃（边下边播）";
                resolve(null);
              });
            }
            musicCacheInfo = "命中缓存（" + Math.round(b.size / 1024) + "KB，未走网络）";
            resolve(URL.createObjectURL(b));
          });
        });
      }).catch(function (e) {
        musicCacheInfo = "读取缓存失败（边下边播）" + (e && e.message ? "：" + e.message : "");
        resolve(null);
      });
    });
  }

  /**
   * 后台把整首曲子补进缓存（只写缓存，不参与播放）。
   * 成功判据：完整下载 + 长度校验通过 + cache.put 成功。返回 Promise<boolean>，失败不抛。
   */
  function loveMusicCacheFill(url, onProgress) {
    return new Promise(function (resolve) {
      if (!musicCacheAvailable() || !url) { resolve(false); return; }
      var abs;
      try { abs = new URL(url, location.href).href; }
      catch (e) { resolve(false); return; }

      var done = false;
      var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
      var guard = setTimeout(function () {
        if (ctrl) { try { ctrl.abort(); } catch (e) {} }
        finish(false, "超时放弃（不影响播放）");
      }, MUSIC_CACHE_FILL_TIMEOUT_MS);

      function finish(ok, note) {
        if (done) return;
        done = true;
        clearTimeout(guard);
        if (note) musicCacheInfo = note;
        resolve(ok);
      }

      caches.open(MUSIC_CACHE_NAME).then(function (cache) {
        return fetch(abs, {
          credentials: "same-origin",
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          var ct = (res.headers.get("content-type") || "").toLowerCase();
          /* 边缘层/WAF 的挑战页也是 200，但内容是 HTML：绝不能存进缓存 */
          if (/html|xml|json/.test(ct)) throw new Error("不是音频响应（" + ct + "）");
          var total = parseInt(res.headers.get("content-length") || "0", 10);
          var reader = (res.body && res.body.getReader) ? res.body.getReader() : null;
          if (!reader) {
            return res.blob().then(function (b) { return { blob: b, total: total }; });
          }
          var chunks = [];
          var got = 0;
          function pump() {
            return reader.read().then(function (r) {
              if (r.done) return;
              chunks.push(r.value);
              got += r.value.length;
              var pct = total ? Math.min(99, Math.round(got / total * 100)) : 0;
              if (onProgress) onProgress(pct);
              return pump();
            });
          }
          return pump().then(function () {
            return { blob: new Blob(chunks, { type: ct || "audio/mpeg" }), total: total };
          });
        }).then(function (got) {
          var blob = got.blob;
          var total = got.total;
          if (!blob || !blob.size) throw new Error("空文件");
          /* 完整性校验：字节数必须等于 Content-Length。
             少了就不写缓存 —— 写进去下次就是"放到一半没了"。 */
          if (total && blob.size !== total) throw new Error("不完整 " + blob.size + "/" + total);
          var payload = new Response(blob, {
            headers: {
              "Content-Type": blob.type || "audio/mpeg",
              "Content-Length": String(blob.size)
            }
          });
          return cache.put(abs, payload).then(function () {
            loveMusicPrune(cache, abs);
            musicCacheDoneAt = Math.round(performance.now());
            finish(true, "已缓存 " + Math.round(blob.size / 1024) + "KB（下次进站零下载）");
          }, function () {
            finish(false, "未写入缓存（配额或隐私模式，下次再补）");
          });
        });
      }).catch(function (e) {
        finish(false, "后台补缓存失败（不影响播放）" + (e && e.message ? "：" + e.message : ""));
      });
    });
  }

  /* ---------- 偏好 / 状态存取 ---------- */
  /* 「关掉音乐」只记在 sessionStorage：旧实现写 localStorage，等于一次误点以后
     这台设备永久静音（mp3 照样下完却一声不响）。现在关掉只影响本次浏览，
     关标签页/重开浏览器即恢复；顺手把旧版本遗留的 localStorage 值清掉。 */
  function musicPrefOn() {
    try {
      var v = sessionStorage.getItem(PREF_KEY);
      if (v === null) {
        try { localStorage.removeItem(PREF_KEY); } catch (e2) {}
        return true;
      }
      return v !== "off";
    } catch (e) { return true; }
  }
  function setMusicPref(on) {
    try { sessionStorage.setItem(PREF_KEY, on ? "on" : "off"); } catch (e) {}
  }
  function readMode() {
    try {
      var m = localStorage.getItem(MODE_KEY);
      return MODE_LABEL[m] ? m : "order";
    } catch (e) { return "order"; }
  }
  function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) {} }

  function trackAt(i) {
    var n = TRACKS.length;
    return TRACKS[((i % n) + n) % n];
  }
  function currentTrack() { return HAS_TRACKS ? trackAt(trackIndex) : null; }

  /**
   * 每次打开/刷新站点时随机挑一首。
   * 排除"上次播的那首"，这样连着打开几次不会老是同一首；
   * 只有一首时就只能放它；列表为空返回 0（调用方会走内置旋律）。
   */
  function pickStartIndex() {
    if (!HAS_TRACKS) return 0;
    var n = TRACKS.length;
    if (n === 1) return 0;
    var last = "";
    try { last = localStorage.getItem(INDEX_KEY) || ""; } catch (e) {}
    var pool = [];
    for (var i = 0; i < n; i++) if (TRACKS[i].id !== last) pool.push(i);
    if (!pool.length) pool.push(0);          // 理论上不会发生，兜一下
    return pool[Math.floor(Math.random() * pool.length)];
  }

    /* ---------- 音频元素（只建一次） ---------- */
  function ensureAudio() {
    if (audioEl) return audioEl;
    audioEl = new Audio();
    audioEl.preload = "auto";
    /* 单曲循环不用 loop 属性：loop 会和"下一首"抢 ended，自己处理更可控 */
    audioEl.loop = false;
    audioEl.volume = 0.55;

    audioEl.addEventListener("playing", function () {
      if (!musicFirstSoundAt) musicFirstSoundAt = Math.round(performance.now());
      hideHint();
      disarmWake();
      clearPlayTimer();
      if (SynthMusic.playing) { try { SynthMusic.stop(); } catch (e) {} }
      musicPlaying = true;
      triedFail = 0;
      starting = false;
      musicBtn.classList.remove("loading");
      setMusicPref(true);
      paint();
      paintProgress();
    });
    audioEl.addEventListener("timeupdate", paintProgress);
    audioEl.addEventListener("loadedmetadata", function () {
      paint();
      paintProgress();
    });
    audioEl.addEventListener("waiting", showBuffering);
    audioEl.addEventListener("stalled", showBuffering);
    audioEl.addEventListener("ended", onEnded);
    audioEl.addEventListener("canplaythrough", warmCacheOnce);
    audioEl.addEventListener("error", function () {
      if (!usingMp3) return;
      audioFail = true;
      starting = false;
      musicPlaying = false;
      musicBtn.classList.remove("loading");
      paint();
      /* 这一首起不来（文件丢了、编码不支持、网络断）：先换一首没试过的，
         整个列表都试过才退回内置旋律 —— 比直接静音友好。
         曾经响过说明这个页面已经有手势，可以直接切合成旋律；否则只能等用户点一下。
         绝不在这里直接 start()，否则会出现"图标在响、实际没声音"。 */
      if (tryAnotherTrack()) return;
      if (gestureSeen) fallbackSynth("音频加载失败，已切换内置旋律");
      else armWake("背景音乐加载失败了，点一下听内置旋律");
    });
    return audioEl;
  }

    function clearPlayTimer() {
    if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  }

  /* 起播：唯一的入口。fromGesture=true 表示这次是用户操作，只有这时才允许退到合成旋律 */
  function startPlayback(fromGesture) {
    if (!audioEl || musicPlaying || starting) return;
    if (fromGesture) gestureSeen = true;
    starting = true;
    musicBtn.classList.add("loading");
    var pr = audioEl.play();
    /* 老内核的 play() 返回 undefined 而不是 Promise，直接 .then 会抛 TypeError */
    if (!pr || typeof pr.then !== "function") {
      fadeIn(audioEl);
      musicPlaying = true;
      starting = false;
      musicBtn.classList.remove("loading");
      paint();
      return;
    }
    clearPlayTimer();
    /* play() 的 promise 可能既不 resolve 也不 reject（缓冲卡住）：
       到点仍未落地就按"你自己点一下"处理，别让人对着转圈干等。 */
    playTimer = setTimeout(function () {
      playTimer = null;
      if (!starting) return;
      starting = false;
      musicBtn.classList.remove("loading");
      armWake("点一下屏幕任意位置，音乐就响");
    }, PLAY_SETTLE_TIMEOUT_MS);
    pr.then(function () {
      /* 真正的收尾在 "playing" 事件里，那里才是"已出声" */
      clearPlayTimer();
    }).catch(function (err) {
      clearPlayTimer();
      starting = false;
      musicBtn.classList.remove("loading");
      /* NotAllowedError = 浏览器拦了自动播放：绝不能退合成旋律（WebAudio 同样需要手势） */
      if (fromGesture && !(err && err.name === "NotAllowedError")) {
        fallbackSynth("播放失败，已切换内置旋律");
      } else {
        armWake("点一下屏幕任意位置，音乐就响");
      }
    });
  }

  function pauseMusic() {
    if (usingMp3 && audioEl) {
      try { audioEl.pause(); } catch (e) {}
    } else {
      SynthMusic.stop();
    }
    musicPlaying = false;
    starting = false;
    musicBtn.classList.remove("loading");
    disarmWake();
    setMusicPref(false);
    paint();
  }

  /**
   * 换到第 i 首。autoPlay=true 时自动起播；gesture=true 表示由点击触发。
   * 先查缓存（毫秒级）再决定播 blob 还是网络地址，两条路都不等整首下载。
   */
  function loadTrack(i, autoPlay, gesture) {
    if (!HAS_TRACKS) return;
    trackIndex = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
    var t = currentTrack();
    try { localStorage.setItem(INDEX_KEY, t.id); } catch (e) {}

    ensureAudio();
    try { audioEl.pause(); } catch (e) {}
    try { audioEl.removeAttribute("src"); } catch (e) {}
    usingMp3 = true;
    audioFail = false;
    musicPlaying = false;
    starting = false;
    musicCacheHit = false;
    musicFirstSoundAt = 0;
    musicCacheDoneAt = 0;
    musicPreparing = true;
    musicBtn.classList.add("loading");
    paint();

    loveMusicCacheLookup(t.url).then(function (u) {
      musicPreparing = false;
      musicCacheHit = !!u;
      audioEl.src = u || t.url;
      musicBtn.classList.remove("loading");
      try { audioEl.load(); } catch (e) {}
      paint();
      paintProgress();
      if (autoPlay) startPlayback(!!gesture);
    });
  }

  function randomOther() {
    if (TRACKS.length < 2) return trackIndex;
    var i = trackIndex;
    while (i === trackIndex) i = Math.floor(Math.random() * TRACKS.length);
    return i;
  }

  /* 某首加载失败时换一首没试过的：最多把整个列表试一遍 */
  function tryAnotherTrack() {
    if (!HAS_TRACKS || TRACKS.length < 2) return false;
    triedFail++;
    if (triedFail >= TRACKS.length) return false;
    loadTrack(randomOther(), true, false);
    return true;
  }

  /* 上一首 / 下一首 */
  function step(dir, fromGesture) {
    if (!HAS_TRACKS) {
      /* 没有曲目：上一首/下一首就是"重播内置旋律" */
      if (dir > 0 && !musicPlaying) startSynth(!!fromGesture);
      return;
    }
    var next;
    if (playMode === "shuffle") next = randomOther();
    else next = trackIndex + dir;
    loadTrack(next, true, !!fromGesture);
  }

  function onEnded() {
    if (!HAS_TRACKS) { musicPlaying = false; paint(); return; }
    if (playMode === "single") {
      try { audioEl.currentTime = 0; } catch (e) {}
      startPlayback(true);
      return;
    }
    if (playMode === "shuffle") { loadTrack(randomOther(), true, false); return; }
    /* 顺序播放：列表播完就停下，不自动绕回第一首 */
    if (trackIndex >= TRACKS.length - 1) { musicPlaying = false; paint(); return; }
    loadTrack(trackIndex + 1, true, false);
  }

  function cycleMode() {
    var i = MODE_ORDER.indexOf(playMode);
    playMode = MODE_ORDER[(i + 1) % MODE_ORDER.length];
    saveMode(playMode);
    paint();
    toast("播放模式：" + MODE_LABEL[playMode]);
  }

  function warmCacheOnce() {
    var t = currentTrack();
    if (!HAS_TRACKS || musicCacheHit || !t || warmedId === t.id) return;
    warmedId = t.id;
    loveMusicCacheFill(t.url, function (pct) {
      musicCacheInfo = "后台补缓存 " + (pct ? pct + "%" : "…");
    });
  }

  /* ---------- 界面 ---------- */
  const musicBtn = document.getElementById("musicBtn");
  const mpPrev = document.getElementById("mpPrev");
  const mpNext = document.getElementById("mpNext");
  const mpListBtn = document.getElementById("mpList");
  const mpPanel = document.getElementById("mpPanel");
  const mpTitle = document.getElementById("mpTitle");
  const mpMode = document.getElementById("mpMode");
  const mpBar = document.getElementById("mpBar");
  const mpFill = document.getElementById("mpFill");
  const mpCur = document.getElementById("mpCur");
  const mpDur = document.getElementById("mpDur");
  const mpListBody = document.getElementById("mpListBody");

  function mpEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function fmtSize(bytes) {
    if (!bytes) return "";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function paint() {
    if (!musicBtn) return;
    var t = currentTrack();
    musicBtn.classList.toggle("off", !musicPlaying);
    /* 图标用 SVG，靠 class 切换播放/暂停，不写字符（字符会被渲染成 emoji/方块） */
    musicBtn.classList.toggle("is-playing", !!musicPlaying);
    musicBtn.title = musicPlaying ? "暂停" : "播放";
    musicBtn.setAttribute("aria-label", musicPlaying ? "暂停" : "播放");
    if (mpTitle) {
      mpTitle.textContent = t ? (t.title || "未命名") : "内置旋律";
      mpTitle.title = mpTitle.textContent;
    }
    if (mpMode) mpMode.textContent = MODE_LABEL[playMode] || "顺序播放";
    /* 没有曲目时切歌没有意义，按键置灰；
       但列表键**保持可用** —— 点开能看到"还没有上传曲目"的说明，
       比一个点不动的按钮更让人明白发生了什么。 */
    if (mpPrev) mpPrev.disabled = !HAS_TRACKS;
    if (mpNext) mpNext.disabled = !HAS_TRACKS;
    if (mpPanel && mpPanel.hasAttribute("hidden") === false) renderList();
  }

  function paintProgress() {
    if (!audioEl) return;
    var d = isFinite(audioEl.duration) ? audioEl.duration : 0;
    var c = audioEl.currentTime || 0;
    if (mpFill) mpFill.style.width = (d ? Math.min(100, c / d * 100) : 0) + "%";
    if (mpCur) mpCur.textContent = fmtTime(c);
    if (mpDur) mpDur.textContent = fmtTime(d);
    /* 进度条是 role=slider：数值要同步，读屏才知道播到哪儿了 */
    if (mpBar) {
      mpBar.setAttribute("aria-valuenow", String(d ? Math.min(100, Math.round(c / d * 100)) : 0));
      mpBar.setAttribute("aria-valuetext", fmtTime(c) + " / " + fmtTime(d));
    }
  }

  function renderList() {
    if (!mpListBody) return;
    if (!HAS_TRACKS) {
      mpListBody.innerHTML = '<div class="mp-empty">还没有上传曲目，正在播放内置旋律</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < TRACKS.length; i++) {
      var t = TRACKS[i];
      html += '<button class="mp-item' + (i === trackIndex ? " active" : "") + '" data-i="' + i + '"' +
              ' aria-current="' + (i === trackIndex ? "true" : "false") + '">' +
                '<span class="mp-i">' + (i === trackIndex ? "♪" : (i + 1)) + '</span>' +
                '<span class="mp-n">' + mpEsc(t.title || "未命名") + '</span>' +
                '<span class="mp-d">' + mpEsc(fmtSize(t.size)) + '</span>' +
              '</button>';
    }
    mpListBody.innerHTML = html;
  }

  function togglePanel(force) {
    if (!mpPanel) return;
    var open = (typeof force === "boolean") ? force : mpPanel.hasAttribute("hidden");
    if (open) {
      renderList();
      mpPanel.removeAttribute("hidden");
      if (document.body) document.body.classList.add("mp-open");
    } else {
      mpPanel.setAttribute("hidden", "");
      if (document.body) document.body.classList.remove("mp-open");
    }
    if (mpListBtn) mpListBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  /* ---------- 提示 / 唤醒（自动播放被拦） ---------- */
  let wakeArmed = false;
  let onWake = null;
  let hintEl = null;
  let fadeTimer = null;

  function showHint(text) {
    var t = text || "点一下开始播放音乐";
    if (hintEl) { hintEl.textContent = t; return; }
    hintEl = document.createElement("div");
    hintEl.className = "music-hint";
    hintEl.textContent = t;
    if (document.body) document.body.appendChild(hintEl);
  }
  function hideHint() {
    if (!hintEl) return;
    try { hintEl.remove(); } catch (e) {}
    hintEl = null;
  }
  /* 静音必须说清楚：只把图标调暗没人看得出来，用户只会以为"音乐坏了" */
  function showMutedHint() {
    showHint("音乐已关闭，点 ▶ 开启");
    if (musicBtn) musicBtn.title = "音乐已关闭（点一下开启）";
  }

  function armWake(msg) {
    if (wakeArmed) return;
    wakeArmed = true;
    musicBtn.classList.remove("loading");
    musicBtn.classList.add("wake");
    showHint("点一下开始播放音乐");
    if (msg) toast(msg);
    onWake = function (e) {
      /* 点播放器本身时交给它的 click 处理器：否则 pointerdown 先起播、紧接着
         click 又看到"在响"把它暂停，点一下等于没点。 */
      var mp = document.getElementById("musicPlayer");
      if (mp && mp.contains(e.target)) return;
      disarmWake();
      if (usingMp3) startPlayback(true);
      else startSynth(true);
    };
    onShell(document, "pointerdown", onWake, true);
    onShell(document, "keydown", onWake, true);
  }
  function disarmWake() {
    hideHint();
    if (!wakeArmed) return;
    wakeArmed = false;
    musicBtn.classList.remove("wake");
    if (onWake) {
      document.removeEventListener("pointerdown", onWake, true);
      document.removeEventListener("keydown", onWake, true);
      onWake = null;
    }
  }

  /* 起播时淡入，避免自动播放突然满音量 */
  function fadeIn(el) {
    clearInterval(fadeTimer);
    var v = 0;
    el.volume = 0;
    fadeTimer = setInterval(function () {
      v = Math.min(0.55, v + 0.055);
      try { el.volume = v; } catch (e) {}
      if (v >= 0.55) clearInterval(fadeTimer);
    }, 150);
  }

  /* 缓冲中要有可见反馈：慢链路上 play() 可能几秒不落地，只有按钮转圈看不出死没死 */
  function showBuffering() {
    if (musicPlaying || !audioEl) return;
    var pct = 0;
    try {
      var d = audioEl.duration;
      if (audioEl.buffered.length && isFinite(d) && d > 0) {
        pct = Math.min(99, Math.round(audioEl.buffered.end(audioEl.buffered.length - 1) / d * 100));
      }
    } catch (e) {}
    showHint(pct > 0 ? "正在缓冲音乐 " + pct + "%…" : "正在缓冲音乐…");
  }

  /* 内置合成旋律（没有后台曲目 / 音频起不来时的兜底） */
  function startSynth(fromGesture) {
    if (fromGesture) gestureSeen = true;
    if (SynthMusic.start()) {
      musicPlaying = true;
      disarmWake();
      musicBtn.classList.remove("loading");
      setMusicPref(true);
      paint();
    } else if (fromGesture) {
      toast("音频起不来，这台设备/浏览器可能不支持", true);
    } else {
      armWake("点一下屏幕任意位置，音乐就响");
    }
  }
  function fallbackSynth(msg) {
    usingMp3 = false;
    audioFail = true;
    starting = false;
    if (audioEl) { try { audioEl.pause(); } catch (e) {} }
    var ok = SynthMusic.start();
    musicPlaying = SynthMusic.playing;
    disarmWake();
    musicBtn.classList.remove("loading");
    paint();
    if (msg) toast(ok ? msg : "音频起不来，这台设备/浏览器可能不支持", true);
  }

  /* 外壳级监听：main.js 是外壳脚本，切页不会重跑，这些监听要活过整个会话 */
  function onShell(target, type, fn, opts) {
    if (typeof shellOn === "function") shellOn(target, type, fn, opts);
    else target.addEventListener(type, fn, opts);
  }

  /* ---------- 初始化 ---------- */
  if (musicBtn) {
    playMode = readMode();
    trackIndex = pickStartIndex();   // 每次打开/刷新随机挑一首（不是固定那首）
    paint();

    if (HAS_TRACKS) {
      if (musicPrefOn()) {
        loadTrack(trackIndex, true, false);     // 进站尝试自动播放（被拦会退到"点一下"）
      } else {
        ensureAudio();
        audioEl.src = currentTrack().url;
        showMutedHint();
      }
    } else if (musicPrefOn()) {
      /* 合成旋律必须等用户手势：先挂提示 */
      armWake("点一下屏幕任意位置，音乐就响");
    } else {
      showMutedHint();
    }

    /* 播放 / 暂停 */
    musicBtn.addEventListener("click", function () {
      if (musicPlaying) { pauseMusic(); return; }
      setMusicPref(true);
      hideHint();
      if (musicBtn) musicBtn.title = "";
      if (musicPreparing) { toast("♪ 音乐正在准备，马上就好"); return; }
      if (!HAS_TRACKS) { startSynth(true); return; }
      if (starting) { toast("♪ 音乐加载中，请稍候…"); return; }
      if (audioEl && audioEl.src && audioEl.paused) startPlayback(true);
      else loadTrack(trackIndex, true, true);
    });

    if (mpPrev) mpPrev.addEventListener("click", function () { step(-1, true); });
    if (mpNext) mpNext.addEventListener("click", function () { step(1, true); });
    if (mpMode) mpMode.addEventListener("click", cycleMode);

    if (mpListBtn) {
      mpListBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        togglePanel();
      });
    }
    if (mpListBody) {
      mpListBody.addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest(".mp-item") : null;
        if (!btn) return;
        var i = parseInt(btn.getAttribute("data-i"), 10);
        if (isNaN(i)) return;
        loadTrack(i, true, true);
      });
    }
    /* 点面板外面 / 按 Esc 收起 */
    onShell(document, "pointerdown", function (e) {
      if (!mpPanel || mpPanel.hasAttribute("hidden")) return;
      /* 面板本身、或整个播放器胶囊上的点击都不算"点外面"：
         否则点一下「下一首」会把刚打开的列表关掉。 */
      var wrap = document.getElementById("musicPlayer");
      if (mpPanel.contains(e.target)) return;
      if (wrap && wrap.contains(e.target)) return;
      togglePanel(false);
    }, true);
    onShell(document, "keydown", function (e) {
      if (e.key === "Escape") togglePanel(false);
    });

    /* 进度条：点击跳转 + 键盘（←/→ 5 秒、Home/End 到首尾） */
    if (mpBar) {
      mpBar.addEventListener("keydown", function (e) {
        if (!audioEl || !isFinite(audioEl.duration)) return;
        var t = audioEl.currentTime, d = audioEl.duration;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          t = Math.max(0, Math.min(d, t + (e.key === "ArrowLeft" ? -5 : 5)));
        } else if (e.key === "Home") {
          e.preventDefault(); t = 0;
        } else if (e.key === "End") {
          e.preventDefault(); t = Math.max(0, d - 1);
        } else {
          return;
        }
        try { audioEl.currentTime = t; } catch (err) {}
        paintProgress();
      });
      mpBar.addEventListener("click", function (e) {
        if (!audioEl || !isFinite(audioEl.duration) || !audioEl.duration) return;
        var r = mpBar.getBoundingClientRect();
        if (!r.width) return;
        var ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        try { audioEl.currentTime = ratio * audioEl.duration; } catch (err) {}
        paintProgress();
      });
    }

      /* 排障开关：网址后加 ?musicdebug=1 */
    if (/[?&]musicdebug=1/.test(location.search)) {
      var dbg = document.createElement("div");
      dbg.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99999;max-width:92vw;" +
        "padding:8px 10px;border-radius:10px;background:rgba(0,0,0,.75);color:#fff;" +
        "font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;pointer-events:none";
      document.body.appendChild(dbg);

      /* 同一个排障开关下挂一个只读/可驱动的小把手：远程排查、自动化验证都用得上，
         正常访问（没有 ?musicdebug=1）时不会存在。 */
      window.__lovePlayer = {
        info: function () {
          var t = currentTrack();
          return {
            index: trackIndex,
            total: TRACKS.length,
            title: t ? (t.title || "") : "",
            mode: playMode,
            playing: musicPlaying,
            panel: !!(mpPanel && !mpPanel.hasAttribute("hidden")),
            cache: musicCacheInfo
          };
        },
        next: function () { step(1, true); },
        prev: function () { step(-1, true); },
        mode: function () { cycleMode(); },
        seekEnd: function () {
          try {
            if (audioEl && isFinite(audioEl.duration)) audioEl.currentTime = Math.max(0, audioEl.duration - 1.2);
          } catch (e) {}
        }
      };
      setInterval(function () {
        var a = audioEl;
        var t = currentTrack();
        dbg.textContent = [
          "track   : " + (t ? (trackIndex + 1) + "/" + TRACKS.length + " " + (t.title || "") : "无（内置旋律）"),
          "mode    : " + playMode,
          "src     : " + (t ? t.url : "-"),
          "audio   : " + (a ? ("rs=" + a.readyState + " ns=" + a.networkState +
                        " paused=" + a.paused + " ct=" + a.currentTime.toFixed(1) +
                        " vol=" + a.volume.toFixed(2)) : "未创建"),
          "buffered: " + (a && a.buffered.length
                        ? a.buffered.end(a.buffered.length - 1).toFixed(1) + "s / " +
                          (isFinite(a.duration) ? a.duration.toFixed(1) + "s" : "?")
                        : "-"),
          "error   : " + (a && a.error ? a.error.code : "无"),
          "state   : " + (musicPlaying ? "在响" : (starting ? "启动中" : (wakeArmed ? "等手势" : "停止"))),
          "cache   : " + musicCacheInfo,
          "first   : " + (musicFirstSoundAt ? (musicFirstSoundAt / 1000).toFixed(1) + "s 出声" : "未出声"),
          "cacheAt : " + (musicCacheDoneAt ? (musicCacheDoneAt / 1000).toFixed(1) + "s 缓存完成" : "-"),
          "pref    : " + (musicPrefOn() ? "on" : "off")
        ].join("\n");
      }, 500);
    }
  }

  /* ---------- 滚动浮现动画 ----------
     基于滚动监听 + 定时兜底(兼容所有环境, 不依赖 IntersectionObserver/rAF) */
  function revealNow() {
    document.querySelectorAll(".reveal:not(.visible)").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.94 && r.bottom > 0) {
        el.classList.add("visible");
      }
    });
  }
  window.addEventListener("scroll", revealNow, { passive: true });
  window.addEventListener("resize", revealNow);
  window.revealNow = revealNow; // 动态生成内容后手动调用
  revealNow();
  setInterval(revealNow, 1000); // 兜底: 任何环境都能浮现

  /* ---------- 站内切页（换视图）后，外壳要重做的事 ----------
     shell.js 每挂载完一个视图就调它一次（外壳级的监听/定时器不用重挂，
     要重做的只有"跟着新视图走"的那几件：品牌名回填、导航高亮、浮现动画）。
     抽成这个钩子而不是让 shell.js 直接调上面三个函数，是为了在 shell.js
     加载顺序变化（它排在 main.js 之后）时仍然只有一个入口。 */
  window.loveOnViewMounted = function () {
    loveBrandFill();
    loveNameFill();          // 新视图 fragment 里写的是引用，换页后同样要解析一次
    loveNavHighlight();
    revealNow();
  };

  /* ---------- Toast 提示 ---------- */
  /* 用 var 而不是 let：toast() 会在"音乐初始化"阶段被同步调用（例如没有曲目时
     用 armWake 提示"点一下播放"），那时本行还没执行到 —— let 会抛
     "Cannot access before initialization"，整个脚本后半段（含按钮绑定）就都不会执行。 */
  var toastTimer = null;
  function toast(text) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      document.body.appendChild(el);
    }
    /* toast 是"音乐起不来/已保存/播放模式"这类反馈的唯一出口：
       不加 aria-live，读屏用户什么也听不到。 */
    if (!el.getAttribute("role")) el.setAttribute("role", "status");
    if (!el.getAttribute("aria-live")) {
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-atomic", "true");
    }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }
  window.toast = toast;

  /* ---------- 通关彩带 ---------- */
  window.burstConfetti = function (duration) {
    /* 与花瓣/飘心同一口径：系统的"减弱动态效果"必须听（F-S10-02）。
       这两个是 canvas 逐帧画的，CSS 的 @media (prefers-reduced-motion) 碰不到它们，
       所以判在这里 —— 放在函数体第一句，任何调用方都绕不过去。 */
    if (reduceMotion) return;
    const canvas = document.getElementById("confettiCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = innerWidth;
    const H = innerHeight;
    fitCanvas(canvas, W, H);
    const colors = ["#f06292", "#ff8aab", "#8B5E3C", "#A67C52", "#D9B48F", "#E8C48A", "#FFFDF8"];
    const parts = [];
    for (let i = 0; i < 160; i++) {
      parts.push({
        x: W / 2, y: H / 2,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 1.2) * 14,
        g: 0.28 + Math.random() * 0.15,
        s: 5 + Math.random() * 7,
        c: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
      });
    }
    const end = Date.now() + (duration || 3000);
    (function draw() {
      ctx.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.vy += p.g; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      });
      if (Date.now() < end) animLoop(draw);
      else ctx.clearRect(0, 0, W, H);
    })();
  };

  /* ---------- 烟花庆祝(特殊日自动放) ----------
     参考 Awesome-Love-Code 等开源特效思路, 零依赖手写实现
     全屏透明覆盖层, 不挡任何操作; 每页每次最多放一轮 */
  window.launchFireworks = function (bursts) {
    /* 同彩带：canvas 特效不受 CSS 的 prefers-reduced-motion 管，必须在这里判（F-S10-02） */
    if (reduceMotion) return;
    const cv = document.getElementById("fxCanvas");
    if (!cv) return;
    /* 按页面区分：sessionStorage 是"每个标签页"共享的，用同一个键时同一标签页里
       只有第一个特殊日页面会放烟花，之后切到别的页面就不再庆祝了。
       存储被禁用时（隐私模式）直接照常放一次。 */
    var fxKey = "fx-done:" + location.pathname;
    try {
      if (sessionStorage.getItem(fxKey)) return;
      sessionStorage.setItem(fxKey, "1");
    } catch (e) { /* 站点存储不可用 → 不拦截 */ }
    const ctx = cv.getContext("2d");
    const W = innerWidth;
    const H = innerHeight;
    fitCanvas(cv, W, H);
    const colors = ["#f06292", "#ff8aab", "#8B5E3C", "#A67C52", "#D9B48F", "#E8C48A", "#FFFDF8"];
    let parts = [];
    const maxBursts = bursts || 6;
    let fired = 0;

    function boom(x, y) {
      const n = 46 + (Math.random() * 24 | 0);
      const c = colors[(Math.random() * colors.length) | 0];
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.3;
        const sp = 2 + Math.random() * 5.2;
        parts.push({
          x: x, y: y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: 0.012 + Math.random() * 0.02,
          c: c,
        });
      }
    }

    const end = Date.now() + 4200;
    (function draw() {
      ctx.clearRect(0, 0, W, H);
      // 定时从底部附近炸几发(错峰)
      if (Date.now() < end - 1500 && fired < maxBursts && Math.random() < 0.08) {
        boom(W * (0.2 + Math.random() * 0.6), H * (0.15 + Math.random() * 0.35));
        fired++;
      }
      parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.055; p.life -= p.decay;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      parts = parts.filter((p) => p.life > 0);
      if (Date.now() < end || parts.length) animLoop(draw);
      else ctx.clearRect(0, 0, W, H);
    })();
  };

  /* ---------- 解锁页花瓣(仅 index.html) ----------
     reduceMotion 与飘心同一口径（见文件末尾的启动飘心）：这 46 片花瓣是持续
     下落的常驻动画，正是"减少动态效果"要关掉的那一类。旧实现漏了这道判断，
     于是开了该选项的访客解锁页照样满屏花瓣。 */
  /* ---------- 解锁页花瓣：装饰动效已精简关闭（只保留爱心心跳 + 切页淡入） ---------- */
  if (false && document.getElementById("petalCanvas") && !reduceMotion) {
    const cv = document.getElementById("petalCanvas");
    const cx = cv.getContext("2d");
    let W, H, petals = [];
    function rs() {
      W = innerWidth;
      H = innerHeight;
      fitCanvas(cv, W, H);
    }
    rs();
    addEventListener("resize", rs);
    const COUNT = innerWidth < 640 ? 28 : 46;
    for (let i = 0; i < COUNT; i++) {
      petals.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 5 + Math.random() * 8,
        vy: 0.5 + Math.random() * 1.2,
        vx: -0.4 + Math.random() * 0.8,
        rot: Math.random() * Math.PI,
        vr: -0.03 + Math.random() * 0.06,
      });
    }
    (function petalFrame() {
      cx.clearRect(0, 0, W, H);
      petals.forEach((p) => {
        p.y += p.vy; p.x += p.vx; p.rot += p.vr;
        if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W; }
        if (p.x > W + 20) p.x = -20;
        if (p.x < -20) p.x = W + 20;
        cx.save();
        cx.translate(p.x, p.y);
        cx.rotate(p.rot);
        cx.globalAlpha = 0.7;
        const g = cx.createLinearGradient(0, -p.r, 0, p.r);
        g.addColorStop(0, "#ffc1d8");
        g.addColorStop(1, "#ff8fb3");
        cx.fillStyle = g;
        cx.beginPath();
        cx.ellipse(0, 0, p.r * 0.55, p.r, 0, 0, Math.PI * 2);
        cx.fill();
        cx.restore();
      });
      animLoop(petalFrame);
    })();
  }

  /* ---------- 光标跟随爱心(仅鼠标设备, 触屏自动关闭) ---------- */
  function cursorHearts() {
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return;
    const canvas = document.createElement("canvas");
    canvas.id = "cursorCanvas";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let W, H;
    function resize() { W = window.innerWidth; H = window.innerHeight; fitCanvas(canvas, W, H); }
    resize();
    window.addEventListener("resize", resize);

    const hearts = [];
    let lastSpawn = 0;
    window.addEventListener("pointermove", (e) => {
      const now = Date.now();
      if (now - lastSpawn < 60) return;
      lastSpawn = now;
      hearts.push({
        x: e.clientX + (Math.random() - 0.5) * 18,
        y: e.clientY + (Math.random() - 0.5) * 18,
        r: 5 + Math.random() * 7,
        vy: -0.5 - Math.random() * 0.6,
        alpha: 0.55,
        born: now,
        hue: Math.random() < 0.8 ? 340 : 25,
      });
      if (hearts.length > 26) hearts.shift();
    }, { passive: true });

    (function loop() {
      ctx.clearRect(0, 0, W, H);
      const now = Date.now();
      for (let i = hearts.length - 1; i >= 0; i--) {
        const h = hearts[i];
        const age = now - h.born;
        if (age > 800) { hearts.splice(i, 1); continue; }
        h.y += h.vy;
        const life = 1 - age / 800;
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.globalAlpha = h.alpha * life;
        ctx.fillStyle = "hsl(" + h.hue + ", 80%, 78%)";
        ctx.beginPath();
        ctx.moveTo(0, h.r * 0.32);
        ctx.bezierCurveTo(-h.r, -h.r * 0.35, -h.r * 0.45, -h.r, 0, -h.r * 0.28);
        ctx.bezierCurveTo(h.r * 0.45, -h.r, h.r, -h.r * 0.35, 0, h.r * 0.32);
        ctx.fill();
        ctx.restore();
      }
      animLoop(loop);
    })();
  }

  /* ---------- 装饰动效已精简：只保留爱心心跳(heartbeat)与切页淡入(pageIn)。
     背景飘心、光标跟随爱心、解锁页花瓣均已关闭。 ---------- */
})();
