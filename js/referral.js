/* =========================================================
   XNY Farms Limited — Referral / affiliate capture
   Loaded on every page. Two jobs:
     1. Capture ?ref=CODE from the URL into localStorage, so the code
        survives the visitor browsing the catalogue and checking out.
     2. Report a completed order to the Cloudflare Pages Function at
        /api/log-referral, which is what actually records the
        commission (localStorage alone would only ever be visible to
        the buyer, never to the business).
   ========================================================= */
(function (window) {
  "use strict";

  var STORAGE_KEY = "xny_ref_code";
  var LOG_ENDPOINT = "/api/log-referral";

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

  /* Report a completed order. Deliberately fire-and-forget:
       - the checkout flow never awaits it, so it can't delay or block
         the customer's payment confirmation;
       - keepalive:true so the request still completes even though the
         confirmation step opens a mailto: link immediately afterwards;
       - it never rejects — a logging outage must never surface to, or
         break checkout for, a paying customer. Failures are logged to
         the console only.

     `order_total_ngn` is the order SUBTOTAL (excluding any delivery
     fee) — that is the commissionable amount the 8% is calculated from.
     The gross total is sent alongside it purely for reconciliation. */
  function logOrder(order) {
    var code = getRefCode();
    if (!code) return Promise.resolve(false);

    if (!order || typeof order.order_total_ngn !== "number" || !order.tx_ref) {
      console.log("[xny] referral not logged: incomplete order details");
      return Promise.resolve(false);
    }

    var payload = {
      ref_code: code,
      order_total_ngn: order.order_total_ngn,
      gross_total_ngn: typeof order.gross_total_ngn === "number" ? order.gross_total_ngn : undefined,
      tx_ref: order.tx_ref,
      timestamp: order.timestamp || new Date().toISOString()
    };

    try {
      return window.fetch(LOG_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      })
        .then(function (res) {
          if (!res.ok) {
            console.log("[xny] referral logging returned HTTP " + res.status);
            return false;
          }
          return true;
        })
        .catch(function (err) {
          console.log("[xny] referral logging failed:", err);
          return false;
        });
    } catch (err) {
      console.log("[xny] referral logging failed:", err);
      return Promise.resolve(false);
    }
  }

  // Run immediately rather than on DOMContentLoaded — this needs only
  // location + localStorage, and capturing early means the code is
  // stored even if the visitor leaves before the page finishes loading.
  captureFromUrl();

  window.XNYReferral = {
    getRefCode: getRefCode,
    setRefCode: setRefCode,
    clearRefCode: clearRefCode,
    captureFromUrl: captureFromUrl,
    logOrder: logOrder
  };
})(window);
