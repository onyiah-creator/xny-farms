/* =========================================================
   XNY Farms Limited — affiliate confirmed (affiliate-confirmed.html)
   The page /api/verify-affiliate redirects to. ?status=ok&code=CODE shows the
   code and personal link; ?status=expired / invalid show a friendly message.
   The code from the URL is checked against the code pattern and only ever
   written with textContent.
   ========================================================= */
(function () {
  "use strict";

  function show(which) {
    ["ok", "expired", "invalid"].forEach(function (name) {
      document.getElementById("confirmed-" + name).hidden = name !== which;
    });
  }

  function copy(text, button, status, what) {
    function done(ok) {
      status.textContent = ok ? "Copied your " + what + "." : "Couldn't copy: please select it and copy it by hand.";
      status.style.color = ok ? "var(--green-700)" : "#b23b2e";
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var params;
    try { params = new window.URLSearchParams(window.location.search); } catch (e) { params = { get: function () { return null; } }; }
    var status = params.get("status");
    var code = (params.get("code") || "").trim();
    var heading = document.getElementById("confirmed-heading");

    if (status === "ok" && /^[A-Za-z0-9]{3,32}$/.test(code)) {
      code = code.toUpperCase();
      var origin = window.location.origin.replace(/\/$/, "");
      var link = origin + "/?ref=" + code;
      heading.textContent = "Email confirmed";
      document.getElementById("confirmed-code").textContent = code;
      document.getElementById("confirmed-link").textContent = link;
      document.getElementById("confirmed-stats").href = "my-stats.html?code=" + encodeURIComponent(code);
      var note = document.getElementById("copy-status");
      document.getElementById("copy-link").addEventListener("click", function () { copy(link, this, note, "link"); });
      document.getElementById("copy-code").addEventListener("click", function () { copy(code, this, note, "code"); });
      show("ok");
    } else if (status === "expired") {
      heading.textContent = "Link expired";
      show("expired");
    } else {
      heading.textContent = "Link problem";
      show("invalid");
    }
  });
})();
