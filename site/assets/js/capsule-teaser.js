/* ============================================================
   情侣网站 · 胶囊入口（首页）+ 到期提醒
   ------------------------------------------------------------
   胶囊原先只在 letter.html 里，到期那天没人会想起来去看。
   这里在首页放一条紧凑的横条：
     有到期的     → "有 N 封可以打开了" + 直达按钮（并 toast 提醒一次）
     没到期的     → "下一封还有 X 天"
     一封都没有   → 整块隐藏，不占版面
   已提醒过的用 localStorage 记（按胶囊的稳定键），刷新不会反复弹。
   ============================================================ */

(function () {
  "use strict";

  var box = document.getElementById("capsuleTeaser");
  if (!box) return;

  var SEEN_KEY = "love-capsule-seen";
  var data = (window.__SERVER_CONTENT__ || {}).capsules || [];
  var today = (function () {
    var n = new Date(), p = function (x) { return String(x).padStart(2, "0"); };
    return n.getFullYear() + "-" + p(n.getMonth() + 1) + "-" + p(n.getDate());
  })();

  function toast(m) { if (window.toast) window.toast(m); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function keyOf(c) { return String(c.uid || (c.openAt + "|" + (c.title || ""))); }

  var open = [], locked = [];
  data.forEach(function (c) {
    if (!c || typeof c !== "object") return;
    if (c.locked === false) open.push(c);
    else if (c.openAt) locked.push(c);
  });
  locked.sort(function (a, b) { return (a.daysLeft || 0) - (b.daysLeft || 0); });

  if (!open.length && !locked.length) { box.hidden = true; return; }

  var html;
  if (open.length) {
    var first = open[0];
    var sub = first && first.title
      ? "最新一封：" + esc(first.title)
      : "写给今天的你们，去拆开吧";
    html =
      '<div class="ct-inner glass">' +
        '<span class="ct-icon">⏳</span>' +
        '<div class="ct-main"><b>有 ' + open.length + " 封时光胶囊可以打开了</b><span>" + sub + "</span></div>" +
        '<a class="btn btn-sm" href="letter.html#capsule">去拆开</a>' +
      "</div>";
  } else {
    var n = locked[0];
    var d = Math.max(0, Number(n.daysLeft) || 0);
    var when = d === 0 ? "就是今天" : ("还有 " + d + " 天");
    var t = n.title ? ("《" + esc(n.title) + "》") : "下一封时光胶囊";
    html =
      '<div class="ct-inner glass">' +
        '<span class="ct-icon">💌</span>' +
        '<div class="ct-main"><b>' + t + " · " + when + "</b><span>到那天才能拆开，先记着</span></div>" +
        '<a class="btn btn-sm btn-ghost" href="letter.html#capsule">看看</a>' +
      "</div>";
  }
  box.innerHTML = html;
  box.hidden = false;

  /* 到期提醒：只在首页、每封只提醒一次 */
  if (open.length) {
    var seen = [];
    try { var v = JSON.parse(localStorage.getItem(SEEN_KEY)); if (Array.isArray(v)) seen = v; } catch (e) {}
    var fresh = open.filter(function (c) { return seen.indexOf(keyOf(c)) < 0; });
    if (fresh.length) {
      setTimeout(function () {
        toast("⏳ 有 " + fresh.length + " 封时光胶囊到期了，在「情书」页最下面");
      }, 2600);
      var next = seen.concat(fresh.map(keyOf)).slice(-60);
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)); } catch (e) {}
    }
  }
})();
