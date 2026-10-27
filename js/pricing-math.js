/* =========================================================
   XNY Farms Limited — pricing maths (shared)

   ONE implementation used by the admin pricing page (browser, as
   window.XNYPricingMath) and by the Pages Functions (imported by
   functions/_lib/pricing.js), so the calculator the admin sees and the
   figures the server records can never disagree. No dependencies, no I/O.

   Definitions
     r  commission rate  (applied to the PRODUCT price only)
     f  processor fee rate (applied to the WHOLE amount charged, so it is
        also charged on the delivery line)
     N  the net the business wants to keep per item
     other  optional per-unit cost the business absorbs (packaging etc.);
            added to N before the formula

   Minimum list price to keep net N:   P = (N + other) / (1 - r - f)
   rounded UP to the rounding step (1, 10 or 50 naira).
     Worked check: N=700, r=0.08, f=0.0215 -> 779.08, listed at 780,
     net kept 700.83.
   Delivery: customer_charge = courier_cost / (1 - f), rounded UP to the step,
   when the fee is passed on (so the delivery line nets to the courier cost
   after the processor fee); otherwise the charge equals the courier cost.

   Money is rounded to kobo (2 dp) the same way everywhere (round2).
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.XNYPricingMath = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STEPS = [1, 10, 50];
  var EPS = 1e-9;

  /** Round to kobo. The epsilon keeps 1.005-style values from rounding the wrong way. */
  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  /* Integer helpers: money in kobo, rates in millionths, so r*P and the net after r and f
     are computed exactly (no 673.8749999 float noise) and rounded once, half up. */
  function kobo(n) { return Math.round(Number(n) * 100 + (n < 0 ? -1e-7 : 1e-7)); }
  function micro(rate) { return Math.round(Number(rate) * 1e6); }
  function mulRate(koboAmount, rate) { return Math.round((koboAmount * micro(rate)) / 1e6); }

  /** Round UP to a multiple of `step`, ignoring float noise (780.0000000001 stays 780). */
  function ceilToStep(value, step) {
    var s = step > 0 ? step : 1;
    return Math.ceil(round2(value) / s - EPS) * s;
  }

  /**
   * Returns null when the pair is fine, otherwise a plain-words error.
   * Rates must be numbers in [0, 0.5], and commission + fee must stay under 0.9 so
   * the price formula (which divides by 1 - r - f) can't blow up.
   */
  function checkRates(r, f) {
    function bad(x) { return typeof x !== "number" || !isFinite(x) || x < 0 || x > 0.5; }
    if (bad(r)) return "The commission rate must be a number between 0% and 50%.";
    if (bad(f)) return "The processor fee rate must be a number between 0% and 50%.";
    if (r + f >= 0.9) return "The commission rate plus the processor fee rate must be under 90%.";
    return null;
  }

  /** Exact (unrounded) minimum price: (N + other) / (1 - r - f), to kobo. */
  function minPriceExact(opts) {
    var err = checkRates(opts.r, opts.f);
    if (err) throw new Error(err);
    var needK = kobo(Number(opts.target) + (Number(opts.otherCost) || 0));
    return Math.round((needK * 1e6) / (1e6 - micro(opts.r) - micro(opts.f))) / 100;
  }

  /** The recommended list price: the exact minimum rounded UP to the step. */
  function recommendedPrice(opts) {
    return ceilToStep(minPriceExact(opts), opts.step || 10);
  }

  /**
   * What happens at price P. commission = r*P, fee = f*P, net_kept = P - commission - fee - other.
   * shortfall is how far net_kept is under the target (0 when the target is met).
   */
  function breakdown(price, opts) {
    var P = Number(price);
    var Pk = kobo(P);
    var commission = mulRate(Pk, opts.r) / 100;
    var fee = mulRate(Pk, opts.f) / 100;
    var other = round2(Number(opts.otherCost) || 0);
    // net is worked out on the unrounded figures and rounded once, so it is the number the
    // formula guarantees (the commission and fee lines above are each rounded for display).
    var net = (Math.round((Pk * (1e6 - micro(opts.r) - micro(opts.f))) / 1e6) - kobo(other)) / 100;
    var target = opts.target == null ? null : Number(opts.target);
    var shortfall = target == null ? 0 : Math.max(0, round2(target - net));
    return {
      price: P,
      commission: commission,
      fee: fee,
      other_cost: other,
      net_kept: net,
      target: target,
      shortfall: shortfall,
      meets_target: target == null ? net >= 0 : shortfall === 0,
      loses_money: net < 0
    };
  }

  /** The customer charge for delivery that nets to the courier cost after the fee (or the plain cost). */
  function deliveryCharge(opts) {
    var cost = Number(opts.courierCost);
    if (!opts.passFee) return cost;
    if (typeof opts.f !== "number" || !isFinite(opts.f) || opts.f < 0 || opts.f >= 0.9) throw new Error("The processor fee rate must be between 0% and 90%.");
    return ceilToStep(Math.round((kobo(cost) * 1e6) / (1e6 - micro(opts.f))) / 100, opts.step || 10);
  }

  /** The processor fee on a delivery charge and what is left against the courier cost. */
  function deliveryBreakdown(charge, opts) {
    var c = Number(charge);
    var fee = mulRate(kobo(c), opts.f) / 100;
    var net = round2(c - fee);
    var cost = round2(Number(opts.courierCost));
    return { charge: c, fee: fee, net: net, courier_cost: cost, shortfall: Math.max(0, round2(cost - net)), surplus: Math.max(0, round2(net - cost)) };
  }

  /**
   * Admin preview of a sample order. items: [{ price, qty, other_cost? }].
   * The processor fee is on the WHOLE amount charged; commission is on the product subtotal
   * only (shown as if the order were referred); delivery costs the courier cost.
   */
  function orderPreview(opts) {
    var subtotal = 0, other = 0;
    (opts.items || []).forEach(function (it) {
      subtotal += Number(it.price) * Number(it.qty);
      other += (Number(it.other_cost) || 0) * Number(it.qty);
    });
    subtotal = round2(subtotal);
    var delivery = round2(Number(opts.deliveryCharge) || 0);
    var total = round2(subtotal + delivery);
    var fee = mulRate(kobo(total), opts.f) / 100;
    var commission = mulRate(kobo(subtotal), opts.r) / 100;
    var courier = round2(Number(opts.courierCost) || 0);
    other = round2(other);
    return {
      subtotal: subtotal,
      delivery_charge: delivery,
      total_charged: total,
      processor_fee: fee,
      commission: commission,
      delivery_cost: courier,
      other_costs: other,
      net_kept: round2(total - fee - commission - courier - other)
    };
  }

  /** 0.08 -> "8%", 0.0215 -> "2.15%", 0.075 -> "7.5%". */
  function formatRate(rate) {
    var pct = Math.round(Number(rate) * 10000) / 100;
    return String(pct) + "%";
  }

  /** ₦1,500 / ₦1,500.50 (hand-rolled: no dependence on the runtime's locale data). */
  function formatNgn(amount) {
    var n = round2(amount);
    var parts = Math.abs(n).toFixed(2).split(".");
    var grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (n < 0 ? "-" : "") + "₦" + grouped + (parts[1] === "00" ? "" : "." + parts[1]);
  }

  return {
    STEPS: STEPS,
    round2: round2,
    ceilToStep: ceilToStep,
    checkRates: checkRates,
    minPriceExact: minPriceExact,
    recommendedPrice: recommendedPrice,
    breakdown: breakdown,
    deliveryCharge: deliveryCharge,
    deliveryBreakdown: deliveryBreakdown,
    orderPreview: orderPreview,
    formatRate: formatRate,
    formatNgn: formatNgn
  };
});
