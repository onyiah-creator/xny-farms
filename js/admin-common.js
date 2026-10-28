/* =========================================================
   XNY Farms Limited — shared admin helpers

   XNYAdmin.request(url, init) -> Promise<{ status, data }>
     The one way the admin pages call their /api endpoints. It never follows a redirect: if the session
     with Cloudflare Access has expired, Access answers with a redirect to its login page (or an HTML page),
     which is not JSON. That is caught here and turned into
       { status: 401, data: { ok: false, error: "Your session expired. Reload this page to sign in again.", expired: true } }
     so every page shows a plain message instead of a JSON error. A server answer that says Cloudflare
     Access is required (code "access_required") is treated the same way. A network failure still rejects.

   The first successful call also loads the protection banner (from /api/admin-status) at the top of the
   page: green "Protected by Cloudflare Access as <email>", or an amber warning when Access is not enforced.
   ========================================================= */
(function () {
  "use strict";

  var EXPIRED = "Your session expired. Reload this page to sign in again.";
  var bannerLoaded = false;

  function expired() {
    return { status: 401, data: { ok: false, error: EXPIRED, expired: true } };
  }

  function request(url, init) {
    init = init || {};
    init.redirect = "manual";            // an Access login redirect shows up as an opaque redirect, not a followed page
    init.credentials = "same-origin";
    return window.fetch(url, init).then(function (res) {
      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return expired();
      var type = res.headers.get("Content-Type") || "";
      if (type.indexOf("json") === -1) return expired();
      return res.json().then(function (data) {
        if (data && data.code === "access_required") return expired();
        var out = { status: res.status, data: data || {} };
        if (res.status === 200 && out.data.ok && !bannerLoaded && url !== "/api/admin-status") maybeLoadBanner(init);
        return out;
      }, function () { return expired(); });
    });
  }

  function maybeLoadBanner(init) {
    var password = "";
    try { password = JSON.parse(init.body).password || ""; } catch (e) { /* not a password-carrying call */ }
    if (!password) return;
    bannerLoaded = true;
    showBanner(password);
  }

  function showBanner(password) {
    var box = document.getElementById("access-banner");
    if (!box) return;
    request("/api/admin-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password })
    }).then(function (r) {
      var d = r.data || {};
      box.textContent = "";
      if (d.expired) { box.className = "access-banner access-banner--warn no-print"; box.textContent = EXPIRED; box.hidden = false; return; }
      if (!d.ok) { box.hidden = true; return; }
      if (d.access_enforced && d.access_jwt_valid) {
        box.className = "access-banner access-banner--ok no-print";
        box.textContent = "Protected by Cloudflare Access as " + d.admin_email;
      } else {
        box.className = "access-banner access-banner--warn no-print";
        var strong = document.createElement("strong");
        strong.textContent = "Cloudflare Access is not enforced. ";
        box.appendChild(strong);
        box.appendChild(document.createTextNode(
          (d.access_jwt_valid ? "You are signed in through Access as " + d.admin_email + ", but the server does not require it yet. " : "") +
          (d.access_configured ? "" : "It is not configured yet. ") +
          "Until it is, the admin password is the only thing protecting these tools."));
      }
      box.hidden = false;
    }).catch(function () { box.hidden = true; });
  }

  window.XNYAdmin = { request: request, showBanner: showBanner, EXPIRED_MESSAGE: EXPIRED };
})();
