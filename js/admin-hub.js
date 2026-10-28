/* =========================================================
   XNY Farms Limited — admin hub (admin.html)

   Sign in with the report password to see the protection banner and the activity log (the audit
   trail from /api/get-audit-log: time, who, action, summary; newest first, at most 200).
   The password is held in memory only. Everything is drawn with textContent.
   ========================================================= */
(function () {
  "use strict";

  var password = "";
  var els = {};

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function whenText(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso || "") : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function labelFor(action) {
    return String(action || "").replace(/[._]/g, " ");
  }

  function render(data) {
    els.list.textContent = "";
    data.entries.forEach(function (e) {
      var li = el("li", "audit-item");
      var top = el("div", "audit-item__top");
      top.appendChild(el("span", "audit-item__when", whenText(e.at)));
      top.appendChild(el("span", "badge audit-item__action", labelFor(e.action)));
      li.appendChild(top);
      li.appendChild(el("div", "audit-item__summary", e.summary));
      var who = el("div", "audit-item__who", e.actor_email);
      if (e.actor_ip && e.actor_ip !== "unknown") who.appendChild(document.createTextNode(" · " + e.actor_ip));
      li.appendChild(who);
      els.list.appendChild(li);
    });
    els.empty.hidden = data.entries.length > 0;
    els.count.textContent = data.total > data.entries.length
      ? "Showing the latest " + data.entries.length + " of " + data.total + " entries."
      : data.entries.length + " entr" + (data.entries.length === 1 ? "y" : "ies") + ".";
  }

  function load() {
    els.error.textContent = "";
    return window.XNYAdmin.request("/api/get-audit-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password })
    }).then(function (r) {
      els.signin.disabled = false;
      if (r.status === 200 && r.data.ok) {
        els.gate.hidden = true;
        els.activity.hidden = false;
        render(r.data);
        return;
      }
      var msg = r.data.error || "Could not load the activity log.";
      if (els.activity.hidden) { els.status.textContent = msg; els.status.style.color = "#b23b2e"; password = ""; }
      else { els.error.textContent = msg; els.error.style.color = "#b23b2e"; }
    }).catch(function () {
      els.signin.disabled = false;
      var msg = "Could not reach the server.";
      if (els.activity.hidden) { els.status.textContent = msg; els.status.style.color = "#b23b2e"; } else { els.error.textContent = msg; els.error.style.color = "#b23b2e"; }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var $ = function (id) { return document.getElementById(id); };
    els.gate = $("hub-gate"); els.form = $("hub-form"); els.password = $("hub-password"); els.signin = $("hub-signin"); els.status = $("hub-status");
    els.activity = $("hub-activity"); els.count = $("hub-count"); els.refresh = $("hub-refresh"); els.error = $("hub-error"); els.empty = $("hub-empty"); els.list = $("audit-list");
    if (!els.form) return;
    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!els.form.checkValidity()) { els.form.reportValidity(); return; }
      password = els.password.value;
      els.signin.disabled = true;
      els.status.textContent = "Loading…";
      els.status.style.color = "var(--muted)";
      load();
    });
    els.refresh.addEventListener("click", load);
  });
})();
