/* =========================================================
   XNY Farms Limited — Referral / affiliate capture
   Loaded on every page. One job: capture ?ref=CODE from the URL into
   localStorage, so the code survives the visitor browsing the catalogue
   and checking out. The checkout sends the code to /api/create-order,
   which binds it to the order; commission is credited by the SERVER
   only after Flutterwave confirms payment. The browser never reports
   a sale.
   ========================================================= */
(function (window) {
  "use strict";

  var STORAGE_KEY = "xny_ref_code";

  // Referral codes end up inside KV key names, so keep them to a
  // conservative character set. Anything outside it is ignored rather
  // than stored, so a junk or hostile ?ref= value can't be persisted.
  var CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

  function isValidCode(code) {
    return typeof code === "string" && CODE_PATTERN.test(code);
  }

  function getRefCode() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY) || "";
      return isValidCode(stored) ? stored : "";
    } catch (e) {
      return "";
    }
  }

  function setRefCode(code) {
    try { window.localStorage.setItem(STORAGE_KEY, code); }
    catch (e) { /* private browsing / quota — attribution just won't persist */ }
  }

  function clearRefCode() {
    try { window.localStorage.removeItem(STORAGE_KEY); }
    catch (e) { /* nothing to do */ }
  }

  /* A visit carrying ?ref= stores (or replaces) the code. A visit WITHOUT
     one deliberately leaves whatever is already stored alone — so a
     referred visitor who comes back later, or navigates in from a plain
     link, is still credited to the affiliate who sent them. */
  function captureFromUrl() {
    var code = "";
    try {
      code = new window.URLSearchParams(window.location.search).get("ref") || "";
    } catch (e) {
      return getRefCode();
    }
    code = code.trim();
    if (code && isValidCode(code)) setRefCode(code);
    return getRefCode();
  }

  // Run immediately rather than on DOMContentLoaded — this needs only
  // location + localStorage, and capturing early means the code is
  // stored even if the visitor leaves before the page finishes loading.
  captureFromUrl();

  window.XNYReferral = {
    getRefCode: getRefCode,
    setRefCode: setRefCode,
    clearRefCode: clearRefCode,
    captureFromUrl: captureFromUrl
  };
})(window);
