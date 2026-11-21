/* ============================================================
   情侣网站 · 通知中心 / 全站搜索 / 往年今日
   ------------------------------------------------------------
   三个功能共享同一份"内容"（CONFIG + 注入的 __SERVER_NOTIFY__），
   放在一个文件里，省掉三次请求与三套重复的日期/转义工具。
   原则：都只读数据、不写后端；每块独立 try/catch ——
   某一项出错不能把另外两项和页面其他功能一起带走。
   ============================================================ */
(function () {
  "use strict";

  /* config.js 里的 CONFIG 是顶层 const —— 它只生成"全局词法绑定"，**不会**
     挂到 window 上。所以不能写 window.CONFIG（拿到的是 undefined），
     要用 typeof 判断后再取。 */
  var CFG = (typeof CONFIG !== "undefined" && CONFIG) ? CONFIG : (window.CONFIG || {});
  function byId(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function oneLine(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function clip(s, n) { s = oneLine(s); return s.length > n ? s.slice(0, n) + "…" : s; }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function mmdd(d) { return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

  /* 支持 'YYYY-MM-DD' 与 unix 秒；其它一律当无效 */
  function toDate(v) {
    if (typeof v === "number" && v > 0) return new Date(v * 1000);
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function relTime(ts) {
    var t = ts > 1e12 ? ts : ts * 1000;
    var diff = Date.now() - t;
    if (!isFinite(diff) || diff < 0) return "刚刚";
    var min = Math.floor(diff / 60000);
    if (min < 1) return "刚刚";
    if (min < 60) return min + " 分钟前";
    var h = Math.floor(min / 60);
    if (h < 24) return h + " 小时前";
    var d = Math.floor(h / 24);
    if (d < 30) return d + " 天前";
    return Math.floor(d / 30) + " 个月前";
  }
  function photoUrl(src) {
    return window.lovePhotoUrl ? window.lovePhotoUrl(src) : src;
  }

  /* ============================================================
     ① 通知中心
     - 条目由服务端算（只给候选 + 稳定 id），已读由本设备记
     - 首次访问把所有现有条目记为已读：否则一进站就"99+"，反而没意义
     ============================================================ */
  (function notify() {
    var btn = byId("notifyBtn");
    var dot = byId("notifyDot");
    if (!btn) return;

    var items = [];
    try {
      items = Array.isArray(window.__SERVER_NOTIFY__) ? window.__SERVER_NOTIFY__ : [];
    } catch (e) { items = []; }

    var KEY = "love-notify-seen";
    var firstRun = false;
    var seen = [];
    try {
      var raw = localStorage.getItem(KEY);
      if (raw === null) { firstRun = true; seen = []; }
      else { seen = JSON.parse(raw) || []; if (!Array.isArray(seen)) seen = []; }
    } catch (e) { seen = []; }

    function ids() { return items.map(function (i) { return i.id; }); }
    function saveSeen() {
      try { localStorage.setItem(KEY, JSON.stringify(seen.slice(-400))); } catch (e) {}
    }
    function unread() {
      return items.filter(function (i) { return seen.indexOf(i.id) < 0; });
    }
    function paintDot() {
      if (!dot) return;
      var n = unread().length;
      dot.hidden = n === 0;
      if (n > 0) dot.textContent = n > 9 ? "9+" : String(n);
      btn.setAttribute("aria-label", n ? "通知（" + n + " 条未读）" : "通知");
    }

    if (firstRun) { seen = ids(); saveSeen(); }

    var ICON = { photo: "🖼", capsule: "⏳", daily: "❓", letter: "💌" };
    var panel = null;

    function renderPanel() {
      var html = "";
      if (!items.length) {
        html = '<div class="notify-empty">还没有新消息。等 TA 传照片、写情书，这里会有提示。</div>';
      } else {
        html = items.map(function (it) {
          var un = seen.indexOf(it.id) < 0;
          return '<a class="notify-item' + (un ? " unread" : "") + '" href="' + esc(it.url || "home.html") + '">' +
                   '<span class="notify-ico" aria-hidden="true">' + (ICON[it.type] || "🔔") + '</span>' +
                   '<span class="notify-main">' +
                     '<span class="notify-title">' + esc(clip(it.title, 40)) + '</span>' +
                     '<span class="notify-time">' + esc(relTime(it.ts)) + '</span>' +
                   '</span>' +
                 '</a>';
        }).join("");
      }
      return html;
    }

    function openPanel() {
      if (!panel) {
        panel = document.createElement("div");
        panel.className = "notify-panel glass";
        panel.id = "notifyPanel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "通知");
        panel.innerHTML =
          '<div class="notify-head"><strong>通知</strong>' +
          '<button class="notify-clear" id="notifyClear" type="button">全部已读</button></div>' +
          '<div class="notify-list" id="notifyList"></div>';
        document.body.appendChild(panel);
        panel.addEventListener("click", function (e) {
          if (e.target && e.target.id === "notifyClear") {
            seen = seen.concat(ids());
            saveSeen();
            byId("notifyList").innerHTML = renderPanel();
            paintDot();
          }
        });
      }
      byId("notifyList").innerHTML = renderPanel();
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      /* 打开即视为已读：已经"看到列表"了，再做红点没有意义 */
      seen = seen.concat(ids());
      saveSeen();
      paintDot();
    }
    function closePanel() {
      if (!panel) return;
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }

    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (panel && !panel.hidden) closePanel(); else openPanel();
    });
    document.addEventListener("pointerdown", function (e) {
      if (!panel || panel.hidden) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      closePanel();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePanel();
    });

    paintDot();
    /* 停留期间对方刚好发了东西：每 60 秒重新取一次（只读，成本极低） */
    setInterval(function () {
      try {
        fetch("api/config.php", { credentials: "same-origin", cache: "no-store" })
          .then(function (r) { return r.text(); })
          .then(function (t) {
            var m = /window\.__SERVER_NOTIFY__\s*=\s*(\[[^\n]*\]);/.exec(t);
            if (!m) return;
            var next = JSON.parse(m[1]);
            if (!Array.isArray(next)) return;
            var before = items.length;
            items = next;
            if (items.length !== before) { paintDot(); if (panel && !panel.hidden) byId("notifyList").innerHTML = renderPanel(); }
          })
          .catch(function () {});
      } catch (e) {}
    }, 60000);
  })();

  /* ============================================================
     ② 全站搜索
     - 索引在本地构建（内容本来就已经注入到页面里），不发请求
     - Ctrl/Cmd+K 或 "/" 打开；Esc 关闭
     ============================================================ */
  (function search() {
    var btn = byId("searchBtn");
    if (!btn) return;

    var index = [];
    function add(type, title, text, date, url, img) {
      title = oneLine(title); text = oneLine(text);
      if (!title && !text) return;
      index.push({ type: type, title: title || text, text: text, date: date || "", url: url || "home.html", img: img || "" });
    }

    (CFG.letters || []).forEach(function (l) { add("情书", l.title, l.body, l.date, "letter.html"); });
    (CFG.messages || []).forEach(function (m) { if (typeof m === "string") add("留言", m, m, "", "home.html"); });
    (CFG.timeline || []).forEach(function (t) { add("时光轴", t.title, t.text, t.date, "timeline.html"); });
    (CFG.gallery || []).forEach(function (p) { if (p && (p.cap || p.src)) add("相册", p.cap || "照片", p.cap, "", "gallery.html", p.src); });
    (CFG.anniversaries || []).forEach(function (a) { add("纪念日", a.title, a.date, a.date, "anniversary.html"); });
    (CFG.wishes || []).forEach(function (w) {
      var txt = typeof w === "string" ? w : (w && (w.text || w.title)) || "";
      add("心愿瓶", txt, txt, "", "home.html");
    });

    var mask = null, input = null, listEl = null, metaEl = null, lastFocus = null;

    function snippet(text, q) {
      text = oneLine(text);
      var i = text.toLowerCase().indexOf(q);
      if (i < 0) return esc(clip(text, 70));
      var from = Math.max(0, i - 24);
      var to = Math.min(text.length, i + q.length + 44);
      var head = from > 0 ? "…" : "";
      var tail = to < text.length ? "…" : "";
      return esc(head + text.slice(from, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" +
             esc(text.slice(i + q.length, to) + tail);
    }

    function render(q) {
      q = q.trim().toLowerCase();
      if (!q) { listEl.innerHTML = '<div class="search-hint">输入关键词，搜索情书、留言、时光轴、相册说明…</div>'; metaEl.textContent = ""; return; }
      var hits = [];
      for (var i = 0; i < index.length; i++) {
        var it = index[i];
        var hay = (it.title + " " + it.text).toLowerCase();
        var pos = hay.indexOf(q);
        if (pos < 0) continue;
        hits.push({ it: it, score: (it.title.toLowerCase().indexOf(q) >= 0 ? 0 : 1) * 100 + pos });
      }
      hits.sort(function (a, b) { return a.score - b.score; });
      var top = hits.slice(0, 30);
      metaEl.textContent = hits.length ? ("找到 " + hits.length + " 条" + (hits.length > 30 ? "，显示前 30 条" : "")) : "没有匹配的内容";
      if (!top.length) { listEl.innerHTML = '<div class="search-hint">没有找到。试试更短的关键词？</div>'; return; }
      listEl.innerHTML = top.map(function (h) {
        var it = h.it;
        var thumb = it.img ? '<img class="search-thumb" src="' + esc(photoUrl(it.img)) + '" alt="" loading="lazy">' : "";
        return '<a class="search-item" href="' + esc(it.url) + '">' + thumb +
                 '<span class="search-main"><span class="search-row"><span class="search-type">' + esc(it.type) + '</span>' +
                 '<span class="search-title">' + snippet(it.title, q) + '</span></span>' +
                 '<span class="search-text">' + (it.text && it.text !== it.title ? snippet(it.text, q) : "") + '</span></span>' +
               '</a>';
      }).join("");
    }

    function open() {
      if (!mask) {
        mask = document.createElement("div");
        mask.className = "search-mask";
        mask.hidden = true;
        mask.innerHTML =
          '<div class="search-box glass" role="dialog" aria-modal="true" aria-label="全站搜索">' +
            '<div class="search-bar">' +
              '<span class="search-ico" aria-hidden="true">🔍</span>' +
              '<input id="searchInput" type="search" placeholder="搜索情书 / 留言 / 时光轴 / 相册…" autocomplete="off" aria-label="搜索关键词">' +
              '<button class="search-close" id="searchClose" type="button" aria-label="关闭搜索">✕</button>' +
            '</div>' +
            '<div class="search-meta" id="searchMeta" aria-live="polite"></div>' +
            '<div class="search-list" id="searchList"></div>' +
          '</div>';
        document.body.appendChild(mask);
        input = byId("searchInput");
        listEl = byId("searchList");
        metaEl = byId("searchMeta");
        input.addEventListener("input", function () { render(input.value); });
        byId("searchClose").addEventListener("click", close);
        mask.addEventListener("pointerdown", function (e) { if (e.target === mask) close(); });
        document.addEventListener("keydown", function (e) {
          if (e.key === "Escape" && !mask.hidden) close();
        });
        render("");
      }
      lastFocus = document.activeElement;
      mask.hidden = false;
      document.body.classList.add("search-open");
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
    }
    function close() {
      if (!mask) return;
      mask.hidden = true;
      document.body.classList.remove("search-open");
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }

    btn.addEventListener("click", open);
    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); open(); return; }
      if (e.key === "/" && !typing) { e.preventDefault(); open(); }
    });
  })();

  /* ============================================================
     ③ 往年今天（只在首页渲染）
     - 按"月-日"匹配往年的照片 / 情书 / 时光轴 / 胶囊
     - 没有命中就把区块留空（隐藏），不占版面
     ============================================================ */
  (function memory() {
    var host = byId("memorySection");
    if (!host) return;

    var today = new Date();
    var key = mmdd(today);
    var thisYear = today.getFullYear();
    var hits = [];

    function push(dateVal, kind, title, text, url, img, ts) {
      var d = ts ? toDate(ts) : toDate(dateVal);
      if (!d || isNaN(d.getTime())) return;
      if (d.getFullYear() >= thisYear) return;         // 只要"往年"
      if (mmdd(d) !== key) return;
      hits.push({ d: d, kind: kind, title: oneLine(title) || kind, text: oneLine(text), url: url, img: img || "" });
    }

    (CFG.letters || []).forEach(function (l) { push(l.date, "情书", l.title, l.body, "letter.html"); });
    (CFG.timeline || []).forEach(function (t) { push(t.date, "时光轴", t.title, t.text, "timeline.html"); });
    (CFG.gallery || []).forEach(function (p) { if (p) push("", "照片", p.cap || "那天的一张照片", "", "gallery.html", p.src, p.ts); });
    ((window.__SERVER_CONTENT__ && window.__SERVER_CONTENT__.capsules) || []).forEach(function (c) {
      push(c.openAt, "时光胶囊", c.title, "", "letter.html", "", c.ts);
    });

    if (!hits.length) { host.hidden = true; return; }

    hits.sort(function (a, b) { return b.d - a.d; });
    var top = hits.slice(0, 3);
    var yearsAgo = thisYear - top[0].d.getFullYear();

    var html = '<div class="section-title"><h2>往年的今天</h2>' +
               '<p>' + yearsAgo + ' 年前的 ' + (today.getMonth() + 1) + ' 月 ' + today.getDate() + ' 日</p></div>' +
               '<div class="memory-list">';
    top.forEach(function (h) {
      var badge = (thisYear - h.d.getFullYear()) + " 年前";
      var thumb = h.img ? '<img class="memory-thumb" src="' + esc(photoUrl(h.img)) + '" alt="" loading="lazy">' : "";
      html += '<a class="memory-item glass" href="' + esc(h.url) + '">' + thumb +
                '<span class="memory-body">' +
                  '<span class="memory-meta"><span class="memory-badge">' + badge + '</span>' +
                  '<span class="memory-kind">' + esc(h.kind) + '</span></span>' +
                  '<span class="memory-title">' + esc(clip(h.title, 30)) + '</span>' +
                  (h.text ? '<span class="memory-text">' + esc(clip(h.text, 46)) + '</span>' : "") +
                '</span>' +
              '</a>';
    });
    html += "</div>";
    host.innerHTML = html;
    host.hidden = false;
  })();
})();
