/* ============================================================
   情侣网站 · 双人身份（认领设备 / 昵称头像 / 作者徽章）
   ------------------------------------------------------------
   身份凭据是服务端 HttpOnly Cookie 里的 deviceId，前端不持有。
   这里只做三件事：
     1) 导航里加一个入口，显示"我是谁"（未认领时提示认领）
     2) 认领面板：这台设备是 A 还是 B；可改昵称头像
     3) 给带 data-author="a|b" 的元素自动补一个作者小徽章
        —— 用 MutationObserver，动态渲染的内容也能覆盖，渲染方
        不必再关心"怎么画徽章"。
   ============================================================ */

(function () {
  "use strict";

  var API = "api/identity.php";
  var AVATARS = ["💗", "🌙", "🌷", "🧸", "🍀", "☀️", "🐰", "🐻", "🌻", "🍑", "⭐", "🫧"];
  var SLOTS = ["a", "b"];
  var HINT_KEY = "love-id-hint";

  var state = { me: null, people: null, ok: false, hasDevice: false };
  var panel = null;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) { if (window.toast) window.toast(msg); }

  function call(body) {
    var opt = body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) }
      : { method: "GET", credentials: "same-origin" };
    return fetch(API, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false }; });
    });
  }

  function apply(j) {
    if (!j || !j.ok) return;
    state.ok = true;
    state.me = j.me || null;
    state.people = j.people || null;
    state.hasDevice = !!j.hasDevice;
    paintNav();
  }

  /* ---------- 导航入口 ---------- */
  function paintNav() {
    var link = q("#identityLink");
    if (!link) return;
    var me = state.me;
    var label = me
      ? (me.avatar + " " + (me.name || (me.key === "a" ? "我" : "TA")))
      : "👤 我是谁";
    link.innerHTML = esc(label);
    link.setAttribute("aria-label", me ? "当前身份：" + (me.name || "已认领") + "（点开可修改）" : "认领这台设备");
    link.classList.toggle("id-claimed", !!me);
  }

  function mountNav() {
    var ul = q(".nav-links");
    if (!ul || q("#identityLink")) return;
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.href = "#identity";
    a.id = "identityLink";
    a.textContent = "👤 我是谁";
    a.addEventListener("click", function (e) {
      e.preventDefault();
      openPanel();
    });
    li.appendChild(a);
    ul.appendChild(li);
  }

  /* ---------- 认领面板 ---------- */
  function slotCard(key) {
    var p = (state.people && state.people[key]) || { name: "", avatar: key === "a" ? "💗" : "🌙", claimed: false };
    var isMe = state.me && state.me.key === key;
    var name = p.name || (isMe ? "我" : "TA");
    var btn;
    if (isMe) {
      btn = '<button class="id-btn ghost" type="button" disabled>✓ 这台设备</button>';
    } else if (p.claimed) {
      /* 一个人可能有好几台设备（手机 + 电脑）。已认领不是"锁死"，
         只是多问一句 —— 否则换台设备就再也认领不回来了。 */
      btn = '<button class="id-btn ghost" type="button" data-claim="' + key + '" data-taken="1">这台也是我</button>';
    } else {
      btn = '<button class="id-btn" type="button" data-claim="' + key + '">就是我</button>';
    }
    return (
      '<div class="id-card' + (isMe ? " is-me" : "") + '" data-slot="' + key + '">' +
        '<span class="id-avatar">' + esc(p.avatar || "💗") + "</span>" +
        '<div class="id-meta"><b>' + esc(name) + "</b>" +
          '<i>' + (p.claimed ? "已认领" : "未认领") + "</i></div>" +
        btn +
      "</div>"
    );
  }

  function renderPanel() {
    if (!panel) return;
    var who = state.me ? (state.me.name || "已认领") : "还没认领这台设备";
    var editable = state.me ? state.me.key : "";
    var av = state.me ? state.me.avatar : "💗";
    var nm = state.me ? state.me.name : "";

    panel.querySelector(".id-body").innerHTML =
      '<p class="id-lead">' + esc(who) + "。认领之后，留言、照片、心愿旁会标出是谁写的。</p>" +
      '<div class="id-cards">' + SLOTS.map(slotCard).join("") + "</div>" +
      (editable
        ? '<div class="id-edit">' +
            '<label class="id-label">我的名字</label>' +
            '<input class="id-name" maxlength="12" placeholder="比如 敏琪" value="' + esc(nm) + '">' +
            '<label class="id-label">我的头像</label>' +
            '<div class="id-avatars">' + AVATARS.map(function (x) {
              return '<button type="button" class="id-av' + (x === av ? " on" : "") + '" data-av="' + x + '">' + x + "</button>";
            }).join("") + "</div>" +
            '<div class="id-row"><button class="id-btn" type="button" id="idSave">保存</button>' +
            '<button class="id-btn ghost" type="button" id="idRelease">解除本机认领</button></div>' +
          "</div>"
        : '<p class="id-tip">选一个人点「就是我」，这台设备就归 TA 了。</p>');

    panel.querySelectorAll("[data-claim]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.getAttribute("data-taken") === "1") {
          var nm2 = (state.people && state.people[b.getAttribute("data-claim")] || {}).name || "TA";
          if (!confirm("「" + nm2 + "」名下已经有别的设备了。\n把这一台也归到「" + nm2 + "」名下？")) return;
        }
        b.disabled = true;
        call({ action: "claim", key: b.getAttribute("data-claim") }).then(function (j) {
          if (!j.ok) { toast(j.error || "认领失败"); b.disabled = false; return; }
          apply(j);
          renderPanel();
          toast("认领好了");
        });
      });
    });

    var save = panel.querySelector("#idSave");
    if (save) {
      var picked = av;
      panel.querySelectorAll(".id-av").forEach(function (b) {
        b.addEventListener("click", function () {
          picked = b.getAttribute("data-av");
          panel.querySelectorAll(".id-av").forEach(function (x) { x.classList.remove("on"); });
          b.classList.add("on");
        });
      });
      save.addEventListener("click", function () {
        var name = panel.querySelector(".id-name").value.trim();
        save.disabled = true;
        call({ action: "profile", key: state.me ? state.me.key : "", name: name, avatar: picked }).then(function (j) {
          save.disabled = false;
          if (!j.ok) { toast(j.error || "保存失败"); return; }
          apply(j);
          renderPanel();
          toast("已保存");
        });
      });
      var rel = panel.querySelector("#idRelease");
      if (rel) rel.addEventListener("click", function () {
        if (!confirm("解除这台设备的认领？（内容不会丢，只是不再标作者）")) return;
        call({ action: "release" }).then(function (j) { if (j.ok) { apply(j); renderPanel(); toast("已解除"); } });
      });
    }
  }

  function openPanel() {
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "id-mask";
      panel.innerHTML =
        '<div class="id-panel" role="dialog" aria-modal="true" aria-label="身份设置">' +
          '<button class="id-close" type="button" aria-label="关闭">✕</button>' +
          '<h3>这台设备是谁的？</h3>' +
          '<div class="id-body"></div>' +
        "</div>";
      document.body.appendChild(panel);
      panel.addEventListener("click", function (e) {
        if (e.target === panel || e.target.classList.contains("id-close")) closePanel();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && panel && panel.classList.contains("show")) closePanel();
      });
    }
    renderPanel();
    panel.classList.add("show");
  }
  function closePanel() { if (panel) panel.classList.remove("show"); }

  /* ---------- 作者徽章 ---------- */
  function authorInfo(key) {
    var p = state.people && state.people[key];
    if (!p) return null;
    return { avatar: p.avatar || "", name: p.name || (key === "a" ? "我" : "TA") };
  }

  function decorate(root) {
    var nodes = (root || document).querySelectorAll("[data-author]:not([data-author-done])");
    nodes.forEach(function (el) {
      el.setAttribute("data-author-done", "1");
      var info = authorInfo(el.getAttribute("data-author"));
      if (!info) return;
      var s = document.createElement("span");
      s.className = "author-badge";
      s.innerHTML = esc(info.avatar) + " " + esc(info.name);
      el.appendChild(s);
    });
  }

  function boot() {
    mountNav();
    paintNav();
    decorate(document);

    /* 站内切页会重跑页面脚本，但外壳不重建 —— 这里用 body 上的标记
       保证观察器只挂一次（重复挂会成倍地跑 decorate）。 */
    if (document.body.getAttribute("data-id-booted") === "1") {
      call(null).then(function (j) { if (j && j.ok) apply(j); }).catch(function () {});
      return;
    }
    document.body.setAttribute("data-id-booted", "1");

    /* 动态渲染的内容（留言、照片、心愿）随时可能出现：只观察子节点，
       不观察属性，避免自己插入徽章又触发自己。 */
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].addedNodes.length) { decorate(document); break; }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    call(null).then(function (j) {
      if (!j || !j.ok) return;                       // 静态托管 / 未解锁：静默
      apply(j);
      if (!state.me) {
        var hinted = false;
        try { hinted = localStorage.getItem(HINT_KEY) === "1"; } catch (e) {}
        if (!hinted) {
          try { localStorage.setItem(HINT_KEY, "1"); } catch (e) {}
          setTimeout(function () { toast("点菜单里的「我是谁」，认领这台设备后就能分清谁写的了"); }, 2200);
        }
      }
    }).catch(function () {});
  }

  window.loveIdentity = {
    state: function () { return state; },
    open: openPanel,
    author: authorInfo
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
