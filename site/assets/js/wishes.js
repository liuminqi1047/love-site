/* ============================================================
   情侣网站 · 心愿瓶（想要 → 在做 → 已实现）
   ------------------------------------------------------------
   文案仍来自 config（config.js 默认 + 后台覆盖），状态存在
   data/wishes.json（服务端）。状态键由前端按 title+text 算出：
   默认心愿只写在 config.js 里，服务端读不到那批文案，所以键只能
   由前端给。服务端只认形状（w + 4~20 位 hex）。

   本机新增的心愿走服务器（有 uid、可删）；服务器不可用时（纯静态
   托管）退回 localStorage，至少本机能看见。
   ============================================================ */

(function () {
  "use strict";

  var grid = document.getElementById("wishGrid");
  if (!grid) return;

  var API = "api/wishes.php";
  var LS_KEY = "love-wishes-local";
  var LABEL = { want: "想要", doing: "在做", done: "已实现" };
  var BOTTLES = ["🏺", "🍾", "🥛", "🧴", "🍶", "🥤", "🧃", "🍹", "☕"];

  var CFG = (typeof CONFIG !== "undefined" && CONFIG) ? CONFIG : (window.CONFIG || {});
  var remote = { states: {}, custom: [] };
  var filter = "all";
  var busy = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(m) { if (window.toast) window.toast(m); }

  /* djb2 → 8 位十六进制。前后端不需要一致：键由这里生成、原样存回去。 */
  function hashId(title, text) {
    var s = title + "\u0001" + text, h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return "w" + ("00000000" + (h >>> 0).toString(16)).slice(-8);
  }

  function lsRead() {
    try { var v = JSON.parse(localStorage.getItem(LS_KEY)); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function lsWrite(list) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  function call(body) {
    var opt = body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) }
      : { method: "GET", credentials: "same-origin" };
    return fetch(API, opt).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }

  /* 合并：config 心愿 + 服务器自建 + 本机兜底（服务器不可用时才用） */
  function items() {
    var out = [];
    (CFG.wishes || []).forEach(function (w) {
      if (!w || (!w.title && !w.text)) return;
      var id = hashId(w.title || "", w.text || "");
      var st = remote.states[id] || {};
      out.push({ id: id, title: w.title || "", text: w.text || "", status: st.status || "want", ts: st.ts || 0, source: "config" });
    });
    remote.custom.forEach(function (c) {
      out.push({ id: c.uid, title: c.title, text: c.text || "", status: c.status || "want", ts: c.ts || 0, source: "custom", mine: !!c.mine });
    });
    if (!out.length) {
      lsRead().forEach(function (c) {
        out.push({ id: c.uid, title: c.title, text: c.text || "", status: c.status || "want", ts: c.ts || 0, source: "local", mine: true });
      });
    }
    /* 排序：在做 → 想要 → 已实现；同组内新的在前，config 的保持原有顺序 */
    var rank = { doing: 0, want: 1, done: 2 };
    out.forEach(function (x, i) { x.__i = i; });
    out.sort(function (a, b) {
      var d = rank[a.status] - rank[b.status];
      if (d) return d;
      if (a.__i === b.__i) return 0;
      return a.__i - b.__i;
    });
    return out;
  }

  function counts(list) {
    var c = { want: 0, doing: 0, done: 0 };
    list.forEach(function (x) { c[x.status] = (c[x.status] || 0) + 1; });
    return c;
  }

  function buildToolbar() {
    var host = grid.parentNode;
    var bar = document.createElement("div");
    bar.className = "wish-bar";
    bar.innerHTML =
      '<div class="wish-progress"><div class="wish-bar-track"><i id="wishBarFill"></i></div>' +
        '<span id="wishBarText" class="wish-bar-text"></span></div>' +
      '<div class="wish-filters">' +
        '<button type="button" class="wish-chip on" data-filter="all">全部</button>' +
        '<button type="button" class="wish-chip" data-filter="want">想要</button>' +
        '<button type="button" class="wish-chip" data-filter="doing">在做</button>' +
        '<button type="button" class="wish-chip" data-filter="done">已实现</button>' +
      "</div>" +
      '<button type="button" class="wish-add-btn" id="wishAddBtn">＋ 许个愿</button>' +
      '<div class="wish-form" id="wishForm" hidden>' +
        '<input id="wishTitle" maxlength="30" placeholder="心愿的名字（30 字内）">' +
        '<input id="wishText" maxlength="200" placeholder="想说的话（可留空）">' +
        '<div class="wish-form-row"><button type="button" class="wish-chip on" id="wishSubmit">放进去</button>' +
        '<button type="button" class="wish-chip" id="wishCancel">算了</button></div>' +
      "</div>";
    host.insertBefore(bar, grid);

    bar.querySelectorAll("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.getAttribute("data-filter");
        bar.querySelectorAll("[data-filter]").forEach(function (x) { x.classList.toggle("on", x === b); });
        render();
      });
    });

    var form = bar.querySelector("#wishForm");
    bar.querySelector("#wishAddBtn").addEventListener("click", function () {
      form.hidden = !form.hidden;
      if (!form.hidden) bar.querySelector("#wishTitle").focus();
    });
    bar.querySelector("#wishCancel").addEventListener("click", function () { form.hidden = true; });
    bar.querySelector("#wishSubmit").addEventListener("click", function () { submit(bar); });
    bar.querySelector("#wishText").addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit(bar);
    });
  }

  function submit(bar) {
    if (busy) return;
    var title = bar.querySelector("#wishTitle").value.trim();
    var text = bar.querySelector("#wishText").value.trim();
    if (!title) { toast("先给心愿起个名字吧"); return; }
    busy = true;
    call({ action: "add", title: title, text: text }).then(function (j) {
      busy = false;
      if (!j || !j.ok) {
        /* 服务器不可用：存本机，至少这台设备看得见 */
        var list = lsRead();
        list.push({ uid: hashId(title, text + "|" + Date.now()), title: title, text: text, status: "want", ts: Date.now() });
        if (lsWrite(list)) {
          bar.querySelector("#wishTitle").value = "";
          bar.querySelector("#wishText").value = "";
          bar.querySelector("#wishForm").hidden = true;
          render();
          toast("服务器暂时不可用，先存到本机了");
        } else {
          toast("保存失败，稍后再试");
        }
        return;
      }
      remote = { states: (j.data && j.data.states) || remote.states, custom: (j.data && j.data.custom) || remote.custom };
      bar.querySelector("#wishTitle").value = "";
      bar.querySelector("#wishText").value = "";
      bar.querySelector("#wishForm").hidden = true;
      render();
      toast("愿望已放进瓶子");
    }).catch(function () {
      busy = false;
      toast("网络不太好，稍后再试");
    });
  }

  function setStatus(it, status) {
    if (busy) return;
    busy = true;
    /* 乐观更新必须落在**数据源**上：items() 每次都重新构造对象，
       只改传进来的 it 的话，接下来 render() 会按 states/custom 重新算一遍，
       状态当场被抹回去（表现为"点了没反应"）。 */
    var prevSt = remote.states[it.id] ? Object.assign({}, remote.states[it.id]) : null;
    var ci = -1, prevCustom = null, prevLocal = null, li = -1;
    if (it.source === "custom") {
      ci = remote.custom.findIndex(function (c) { return c.uid === it.id; });
      if (ci >= 0) { prevCustom = remote.custom[ci].status; remote.custom[ci].status = status; }
    } else if (it.source === "local") {
      var ll = lsRead();
      li = ll.findIndex(function (c) { return c.uid === it.id; });
      if (li >= 0) { prevLocal = ll[li].status; ll[li].status = status; lsWrite(ll); }
    } else {
      remote.states[it.id] = { status: status, ts: Math.floor(Date.now() / 1000) };
    }
    it.status = status;
    render();

    function rollback() {
      if (prevSt) remote.states[it.id] = prevSt;
      else delete remote.states[it.id];
      if (ci >= 0 && prevCustom) remote.custom[ci].status = prevCustom;
      if (li >= 0 && prevLocal) {
        var l2 = lsRead();
        l2.forEach(function (c) { if (c.uid === it.id) c.status = prevLocal; });
        lsWrite(l2);
      }
      render();
    }

    call({ action: "status", id: it.id, status: status }).then(function (j) {
      busy = false;
      if (!j || !j.ok) {
        rollback();
        toast((j && j.error) || "状态没保存成功");
        return;
      }
      if (status === "done") toast("🎉 又实现了一个心愿");
    }).catch(function () {
      busy = false;
      rollback();
      toast("网络不太好，状态没保存");
    });
  }

  function del(it) {
    if (!it.mine) return;
    if (!confirm("把这个心愿从瓶子里拿走？")) return;
    if (it.source === "local") {
      lsWrite(lsRead().filter(function (c) { return c.uid !== it.id; }));
      render();
      return;
    }
    call({ action: "delete", id: it.id }).then(function (j) {
      if (!j || !j.ok) { toast((j && j.error) || "删除失败"); return; }
      remote.custom = remote.custom.filter(function (c) { return c.uid !== it.id; });
      render();
      toast("已拿走");
    });
  }

  function render() {
    var all = items();
    var c = counts(all);
    var bar = document.querySelector(".wish-bar");
    if (bar) {
      var total = all.length;
      var pct = total ? Math.round((c.done / total) * 100) : 0;
      var fill = bar.querySelector("#wishBarFill");
      var txt = bar.querySelector("#wishBarText");
      if (fill) fill.style.width = pct + "%";
      if (txt) txt.textContent = total ? ("已实现 " + c.done + " / " + total + "（" + pct + "%）") : "还没有心愿，写下第一个吧";
    }

    var list = filter === "all" ? all : all.filter(function (x) { return x.status === filter; });
    grid.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML =
        '<img class="empty-bear" src="assets/img/yier-bubu.png" alt="一二和布布">' +
        '<p class="empty-text">' + (all.length ? "这个分类里还没有心愿" : "心愿瓶是空的，一二和布布的第一个愿望从这里开始") + "</p>" +
        (all.length ? "" : '<button class="btn empty-btn" type="button" id="emptyWish">✨ 许下第一个愿望</button>');
      grid.appendChild(empty);
      var eb = document.getElementById("emptyWish");
      if (eb) eb.addEventListener("click", function () { var w = document.getElementById("wishAddBtn"); if (w) w.click(); });
      return;
    }

    list.forEach(function (it, i) {
      var el = document.createElement("div");
      el.className = "wish glass reveal st-" + it.status;
      el.style.transitionDelay = (i % 6) * 60 + "ms";
      el.innerHTML =
        '<span class="bottle">' + BOTTLES[i % BOTTLES.length] + "</span>" +
        '<span class="wish-status">' + LABEL[it.status] + "</span>" +
        '<div class="w-title">' + esc(it.title) + "</div>" +
        '<div class="w-text">' + esc(it.text) + "</div>" +
        '<div class="wish-acts">' +
          ["want", "doing", "done"].map(function (s) {
            return '<button type="button" class="wish-set' + (it.status === s ? " on" : "") + '" data-set="' + s + '">' + LABEL[s] + "</button>";
          }).join("") +
          (it.mine ? '<button type="button" class="wish-del" aria-label="移除心愿">✕</button>' : "") +
        "</div>";
      el.addEventListener("click", function (e) {
        if (e.target.classList.contains("wish-set")) {
          var s = e.target.getAttribute("data-set");
          if (s !== it.status) setStatus(it, s);
          return;
        }
        if (e.target.classList.contains("wish-del")) { del(it); return; }
        grid.querySelectorAll(".wish.open").forEach(function (x) { x.classList.remove("open"); });
        el.classList.add("open");
      });
      grid.appendChild(el);
    });
    if (window.revealNow) window.revealNow();
  }

  /* 服务端状态（失败就只用 config + 本机） */
  call(null).then(function (j) {
    if (j && j.ok) {
      remote.states = j.states || {};
      remote.custom = j.custom || [];
    }
    buildToolbar();
    render();
  }).catch(function () {
    buildToolbar();
    render();
  });
})();
