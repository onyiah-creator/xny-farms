/* =========================================================
   XNY Farms Limited — live pricing (storefront, cart, checkout)

   Fetches /api/pricing (public: prices, delivery charges and the affiliate
   commission rate, set by the admin on admin-pricing.html) and exposes it as
   window.XNYPricing. The values below are only the LAST-KNOWN defaults, used
   to draw a page while the request is in flight or if it fails. They are never
   used to take a payment: checkout checks XNYPricing.isLive() and refuses to
   proceed on defaults.

   Loaded before js/cart.js on every page that has a cart badge. It fetches
   only on pages that need prices (a [data-product-id] price, a
   [data-commission-rate] mention, or the cart page), so other pages cost no request.

   Page markup:
     <p class="price" data-product-id="palm-oil-50cl">₦700</p>   (the baked-in
        text is the no-JS fallback and is replaced once prices arrive)
     <strong data-commission-rate>8%</strong>
   ========================================================= */
(function (window) {
  "use strict";

  var ENDPOINT = "/api/pricing";

  // Last-known defaults. DISPLAY ONLY.
  var DEFAULTS = {
    version: null,
    products: { "ashe-honey-50cl": 7000, "ashe-honey-1l": 13000, "palm-oil-50cl": 700, "palm-oil-1l": 1300 },
    delivery: { lagos: 1500, other: 3500 },
    commission_rate: 0.08
  };

  var state = {
    status: "idle",           // idle | loading | ok | error
    version: DEFAULTS.version,
    products: copy(DEFAULTS.products),
    delivery: copy(DEFAULTS.delivery),
    commission_rate: DEFAULTS.commission_rate,
    names: {},
    error: ""
  };
  var inflight = null;
  var listeners = [];

  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function money(n) { return "\u20A6" + Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 }); }

  function formatRate(rate) { return String(Math.round(Number(rate) * 10000) / 100) + "%"; }

  function applyToPage() {
    var priced = document.querySelectorAll("[data-product-id]");
    Array.prototype.forEach.call(priced, function (el) {
      var id = el.getAttribute("data-product-id");
      if (state.status === "ok" && typeof state.products[id] === "number") el.textContent = money(state.products[id]);
    });
    var rates = document.querySelectorAll("[data-commission-rate]");
    Array.prototype.forEach.call(rates, function (el) { el.textContent = formatRate(state.commission_rate); });
  }

  function notify() {
    applyToPage();
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* a listener must not break the others */ } });
  }

  /** Fetches the current pricing. `fresh` bypasses the browser's 30-second cache (checkout does this). */
  function load(fresh) {
    if (inflight && !fresh) return inflight;
    state.status = state.status === "ok" ? "ok" : "loading";
    var attempt = window.fetch(ENDPOINT, { method: "GET", headers: { Accept: "application/json" }, cache: fresh ? "no-store" : "default" })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        var d = r.data || {};
        if (!r.ok || !d.ok || !Array.isArray(d.products) || !d.delivery || typeof d.commission_rate !== "number") {
          throw new Error(d.error || "Prices are unavailable.");
        }
        var products = {};
        var names = {};
        d.products.forEach(function (p) {
          if (p && typeof p.id === "string" && typeof p.price_ngn === "number" && p.price_ngn > 0) {
            products[p.id] = p.price_ngn;
            names[p.id] = { name: p.name, size: p.size };
          }
        });
        if (!Object.keys(products).length) throw new Error("Prices are unavailable.");
        state = {
          status: "ok",
          version: d.version,
          products: products,
          delivery: { lagos: Number(d.delivery.lagos), other: Number(d.delivery.other) },
          commission_rate: d.commission_rate,
          names: names,
          error: ""
        };
        notify();
        return state;
      })
      .catch(function (err) {
        // Keep whatever was last good (or the defaults) for DISPLAY, but say it is not live.
        state.status = "error";
        state.error = String(err && err.message ? err.message : err);
        notify();
        return state;
      })
      .then(function (s) { inflight = null; return s; });
    inflight = attempt;
    return attempt;
  }

  function needsPrices() {
    return !!document.querySelector("[data-product-id], [data-commission-rate], #cart-content");
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (needsPrices()) load(false);
  });

  window.XNYPricing = {
    DEFAULTS: DEFAULTS,
    load: load,
    onChange: function (fn) { listeners.push(fn); },
    getState: function () { return state; },
    /** true only when the figures came from the server (so a payment may use them). */
    isLive: function () { return state.status === "ok"; },
    getPrice: function (id) { return typeof state.products[id] === "number" ? state.products[id] : (DEFAULTS.products[id] || 0); },
    getDelivery: function (zone) { return zone === "lagos" ? state.delivery.lagos : zone === "other" ? state.delivery.other : 0; },
    getVersion: function () { return state.version; },
    getCommissionRate: function () { return state.commission_rate; },
    formatRate: formatRate,
    money: money
  };
})(window);
