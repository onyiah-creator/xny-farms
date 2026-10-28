/* =========================================================
   XNY Farms Limited — Pricing & fees (admin-pricing.html)

   Edits the versioned pricing config through /api/admin-pricing and shows,
   live, what the business keeps at any price. The maths is js/pricing-math.js,
   the SAME file the server uses, so what is shown here is what is recorded.

   The password is held in memory only (a refresh re-asks). Nothing on this
   page is public: the processor fee, target nets and courier costs never
   leave /api/admin-pricing.
   ========================================================= */
(function () {
  "use strict";

  var ENDPOINT = "/api/admin-pricing";
  var M = window.XNYPricingMath;
  var els = {};
  var password = "";
  var base = null;            // the config in force (from the server)
  var versions = [];
  var refs = { products: {}, delivery: {} };
  var pendingInput = null;    // what the open "review changes" panel would save
  var changeCount = 0;        // unsaved edits on the page, shown in the sticky bar

  /* ---------- helpers ---------- */
  var money = M.formatNgn;

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function setText(node, text, kind) {
    node.textContent = text || "";
    node.style.color = kind === "error" ? "#b23b2e" : kind === "good" ? "var(--green-700)" : "var(--muted)";
  }

  function num(input) {
    var v = String(input.value).trim();
    return v === "" ? NaN : Number(v);
  }

  function post(action, payload) {
    var body = payload || {};
    body.password = password;
    body.action = action;
    return window.XNYAdmin.request(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  function dateText(iso) {
    if (!iso) return "built-in starting values";
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function field(labelText, input, hint) {
    var wrap = el("div", "field");
    var label = el("label", "", labelText);
    input.id = input.id || "pr-" + Math.random().toString(36).slice(2, 9);
    label.setAttribute("for", input.id);
    wrap.appendChild(label);
    wrap.appendChild(input);
    if (hint) wrap.appendChild(el("p", "form-note", hint)).style.margin = ".2rem 0 0";
    return wrap;
  }

  function numberInput(value, step) {
    var i = el("input");
    i.type = "number";
    i.inputMode = "decimal";
    i.step = step || "0.01";
    i.min = "0";
    i.value = value === null || value === undefined ? "" : String(value);
    i.addEventListener("input", recalc);
    return i;
  }

  function breakdownRow(dl, label, valueNode) {
    dl.appendChild(el("dt", "", label));
    var dd = el("dd");
    dd.appendChild(typeof valueNode === "string" ? document.createTextNode(valueNode) : valueNode);
    dl.appendChild(dd);
    return dd;
  }

  /* ---------- reading the form ---------- */
  function rates() {
    return {
      r: num(els.commission) / 100,
      f: num(els.fee) / 100
    };
  }

  function ratesError() {
    var x = rates();
    if (isNaN(x.r) || isNaN(x.f)) return "Enter both rates (for example 8 and 2.15).";
    return M.checkRates(x.r, x.f);
  }

  function step() { return Number(els.step.value) || 10; }

  /* ---------- building the page from the config ---------- */
  function build() {
    var c = base;
    els.versionLine.textContent = c.created_at
      ? "Version " + c.version + " is live, saved " + dateText(c.created_at) + (c.note ? " (" + c.note + ")" : "") + "."
      : "Version " + c.version + " is live: the built-in starting values (nothing has been saved yet).";
    els.commission.value = String(Math.round(c.commission_rate * 10000) / 100);
    els.fee.value = String(Math.round(c.processor_fee_rate * 10000) / 100);
    els.step.value = String(c.rounding_step_ngn);
    els.passfee.checked = c.pass_fee_on_delivery;

    els.products.innerHTML = "";
    refs.products = {};
    Object.keys(c.products).forEach(function (id) {
      var p = c.products[id];
      var card = el("div", "form-card pr-card");
      var head = el("div", "pr-card__head");
      head.appendChild(el("h3", "pr-h", p.name + " — " + p.size));
      var cur = el("span", "pr-current", "Current price " + money(p.price_ngn));
      head.appendChild(cur);
      card.appendChild(head);

      var fields = el("div", "pr-fields");
      var target = numberInput(p.target_net_ngn);
      var other = numberInput(p.other_cost_ngn || 0);
      var price = numberInput(p.price_ngn, "1");
      fields.appendChild(field("Net you want to keep per item (₦)", target));
      fields.appendChild(field("Other cost per item you absorb (₦)", other, "Packaging etc. Added to the net before the formula."));
      fields.appendChild(field("Selling price (₦)", price));
      card.appendChild(fields);

      var rec = el("p", "pr-rec");
      var useBtn = el("button", "btn btn--outline btn--sm", "Use recommended");
      useBtn.type = "button";
      card.appendChild(rec);
      card.appendChild(useBtn);

      var dl = el("dl", "pr-break");
      var status = el("p", "pr-status");
      status.setAttribute("role", "status");
      card.appendChild(dl);
      card.appendChild(status);
      els.products.appendChild(card);

      refs.products[id] = { price: price, target: target, other: other, rec: rec, dl: dl, status: status, card: card, useBtn: useBtn, saved: p };
      useBtn.addEventListener("click", function () {
        var r = recommended(id);
        if (r !== null) { price.value = String(r); recalc(); }
      });
    });

    els.delivery.innerHTML = "";
    refs.delivery = {};
    [["lagos", "Lagos"], ["other", "Other Nigerian states"]].forEach(function (z) {
      var key = z[0];
      var d = c.delivery[key];
      var card = el("div", "form-card pr-card");
      card.appendChild(el("h3", "pr-h", "Delivery — " + z[1]));
      var fields = el("div", "pr-fields");
      var courier = numberInput(d.courier_cost_ngn);
      var charge = numberInput(d.customer_charge_ngn, "1");
      fields.appendChild(field("Courier cost to us (₦)", courier));
      fields.appendChild(field("Delivery charge to the customer (₦)", charge, "Type your own to override the calculated one."));
      card.appendChild(fields);
      var rec = el("p", "pr-rec");
      var useBtn = el("button", "btn btn--outline btn--sm", "Use calculated charge");
      useBtn.type = "button";
      card.appendChild(rec);
      card.appendChild(useBtn);
      var dl = el("dl", "pr-break");
      var status = el("p", "pr-status");
      status.setAttribute("role", "status");
      card.appendChild(dl);
      card.appendChild(status);
      els.delivery.appendChild(card);
      refs.delivery[key] = { card: card, courier: courier, charge: charge, rec: rec, dl: dl, status: status, useBtn: useBtn };
      useBtn.addEventListener("click", function () {
        var calc = calcDelivery(key);
        if (calc !== null) { charge.value = String(calc); recalc(); }
      });
    });

    buildSample();
    recalc();
  }

  function buildSample() {
    els.sampleFields.innerHTML = "";
    refs.sample = { qty: {} };
    Object.keys(base.products).forEach(function (id) {
      var q = el("input");
      q.type = "number"; q.min = "0"; q.step = "1"; q.inputMode = "numeric";
      q.value = id === Object.keys(base.products)[0] ? "1" : "0";
      q.addEventListener("input", recalc);
      refs.sample.qty[id] = q;
      els.sampleFields.appendChild(field(base.products[id].name + " " + base.products[id].size + " — quantity", q));
    });
    var zone = el("select");
    [["lagos", "Delivery — Lagos"], ["other", "Delivery — other states"], ["pickup", "Pickup (no delivery)"]].forEach(function (o) {
      var opt = el("option", "", o[1]); opt.value = o[0]; zone.appendChild(opt);
    });
    zone.addEventListener("change", recalc);
    refs.sample.zone = zone;
    els.sampleFields.appendChild(field("Fulfilment", zone));
    var ref = el("input"); ref.type = "checkbox"; ref.checked = true; ref.addEventListener("change", recalc);
    refs.sample.referred = ref;
    var wrap = el("div", "field pr-check");
    var lab = el("label", "consent__label"); lab.appendChild(ref); lab.appendChild(el("span", "", " Order came through an affiliate link (commission is paid)"));
    wrap.appendChild(lab);
    els.sampleFields.appendChild(wrap);
  }

  /* ---------- the maths, on the draft values ---------- */
  function recommended(id) {
    var x = rates();
    var t = num(refs.products[id].target);
    var o = num(refs.products[id].other);
    if (ratesError() || isNaN(t) || t <= 0 || isNaN(o) || o < 0) return null;
    return M.recommendedPrice({ target: t, otherCost: o, r: x.r, f: x.f, step: step() });
  }

  function calcDelivery(key) {
    var x = rates();
    var cost = num(refs.delivery[key].courier);
    if (isNaN(x.f) || isNaN(cost) || cost < 0 || x.f >= 0.9) return null;
    return M.deliveryCharge({ courierCost: cost, f: x.f, passFee: els.passfee.checked, step: step() });
  }

  function recalc() {
    recalcFigures();
    updateActionBar();
  }

  function recalcFigures() {
    var err = ratesError();
    setText(els.rateError, err || "", "error");
    var x = rates();

    Object.keys(refs.products).forEach(function (id) {
      var ref = refs.products[id];
      var target = num(ref.target), other = num(ref.other), price = num(ref.price);
      ref.dl.innerHTML = "";
      ref.status.className = "pr-status";
      var changed = price !== ref.saved.price_ngn || target !== ref.saved.target_net_ngn || other !== (ref.saved.other_cost_ngn || 0);
      ref.card.classList.toggle("is-changed", changed);

      if (err || isNaN(target) || target <= 0 || isNaN(other) || other < 0) {
        ref.rec.textContent = "Enter the net you want to keep to see a recommended price.";
        ref.useBtn.disabled = true;
        setText(ref.status, err || "Check the net and cost figures.", "error");
        return;
      }
      var rec = M.recommendedPrice({ target: target, otherCost: other, r: x.r, f: x.f, step: step() });
      var exact = M.minPriceExact({ target: target, otherCost: other, r: x.r, f: x.f });
      ref.rec.textContent = "Recommended price: " + money(rec) + " (the exact minimum is " + money(exact) + ", rounded up to the nearest ₦" + step() + ").";
      ref.useBtn.disabled = false;

      if (isNaN(price) || price < 1 || price !== Math.floor(price)) {
        setText(ref.status, "Enter the selling price as a whole number of naira.", "error");
        return;
      }
      var b = M.breakdown(price, { r: x.r, f: x.f, target: target, otherCost: other });
      breakdownRow(ref.dl, "Selling price", money(b.price));
      breakdownRow(ref.dl, "Affiliate commission (" + M.formatRate(x.r) + " of the price)", money(b.commission));
      breakdownRow(ref.dl, "Processor fee (" + M.formatRate(x.f) + ")", money(b.fee));
      if (b.other_cost) breakdownRow(ref.dl, "Other cost", money(b.other_cost));
      var keep = breakdownRow(ref.dl, "You keep", money(b.net_kept));
      keep.className = "pr-keep";
      breakdownRow(ref.dl, "Your target", money(b.target));
      if (b.loses_money) {
        ref.status.className = "pr-status pr-status--bad";
        ref.status.textContent = "You lose " + money(-b.net_kept) + " on every sale at this price. You wanted to keep " + money(b.target) + ".";
      } else if (!b.meets_target) {
        ref.status.className = "pr-status pr-status--bad";
        ref.status.textContent = "You keep " + money(b.net_kept) + " instead of " + money(b.target) + ", short by " + money(b.shortfall) + ".";
      } else {
        ref.status.className = "pr-status pr-status--ok";
        ref.status.textContent = "You keep " + money(b.net_kept) + " per item, meeting your target of " + money(b.target) + ".";
      }
    });

    Object.keys(refs.delivery).forEach(function (key) {
      var ref = refs.delivery[key];
      ref.dl.innerHTML = "";
      ref.status.className = "pr-status";
      var cost = num(ref.courier), charge = num(ref.charge);
      if (isNaN(x.f) || isNaN(cost) || cost < 0 || x.f >= 0.9) { ref.rec.textContent = ""; ref.useBtn.disabled = true; setText(ref.status, "Check the courier cost and the fee rate.", "error"); return; }
      var calc = M.deliveryCharge({ courierCost: cost, f: x.f, passFee: els.passfee.checked, step: step() });
      ref.rec.textContent = els.passfee.checked
        ? "Calculated charge: " + money(calc) + " (courier cost ÷ (1 − fee), rounded up). That nets exactly the courier cost after the processor fee."
        : "Calculated charge: " + money(calc) + " (the fee on delivery is absorbed, so the charge equals the courier cost).";
      ref.useBtn.disabled = false;
      if (isNaN(charge) || charge < 0 || charge !== Math.floor(charge)) { setText(ref.status, "Enter the delivery charge as a whole number of naira.", "error"); return; }
      var b = M.deliveryBreakdown(charge, { f: x.f, courierCost: cost });
      breakdownRow(ref.dl, "Customer pays", money(b.charge));
      breakdownRow(ref.dl, "Processor fee on delivery (" + M.formatRate(x.f) + ")", money(b.fee));
      breakdownRow(ref.dl, "Left after the fee", money(b.net));
      breakdownRow(ref.dl, "Courier cost", money(b.courier_cost)).className = "pr-keep";
      if (b.shortfall > 0) {
        ref.status.className = "pr-status pr-status--bad";
        ref.status.textContent = "After the processor fee you receive " + money(b.net) + " for delivery but it costs " + money(b.courier_cost) + ", so you pay " + money(b.shortfall) + " of it yourself.";
      } else {
        ref.status.className = "pr-status pr-status--ok";
        ref.status.textContent = b.surplus > 0
          ? "Covers the courier cost with " + money(b.surplus) + " to spare."
          : "Covers the courier cost exactly.";
      }
    });

    sample(x, err);
  }

  function sample(x, err) {
    els.sampleResult.innerHTML = "";
    if (err) { els.sampleResult.appendChild(el("dd", "", "Fix the rates above to see a preview.")); return; }
    var items = [], bad = false;
    Object.keys(refs.sample.qty).forEach(function (id) {
      var q = num(refs.sample.qty[id]), price = num(refs.products[id].price), other = num(refs.products[id].other) || 0;
      if (isNaN(q) || q < 0) { bad = true; return; }
      if (q > 0) { if (isNaN(price)) { bad = true; return; } items.push({ price: price, qty: q, other_cost: other }); }
    });
    var zone = refs.sample.zone.value;
    var courier = 0, charge = 0;
    if (zone !== "pickup") {
      courier = num(refs.delivery[zone].courier);
      charge = num(refs.delivery[zone].charge);
      if (isNaN(courier) || isNaN(charge)) bad = true;
    }
    if (bad || !items.length) { els.sampleResult.appendChild(el("dd", "", "Enter a quantity of at least one product.")); return; }
    var o = M.orderPreview({ items: items, deliveryCharge: charge, courierCost: courier, r: refs.sample.referred.checked ? x.r : 0, f: x.f });
    breakdownRow(els.sampleResult, "Products", money(o.subtotal));
    breakdownRow(els.sampleResult, "Delivery charged", money(o.delivery_charge));
    breakdownRow(els.sampleResult, "Total the customer pays", money(o.total_charged));
    breakdownRow(els.sampleResult, "Processor fee on the whole amount (" + M.formatRate(x.f) + ")", money(o.processor_fee));
    breakdownRow(els.sampleResult, "Affiliate commission", money(o.commission));
    breakdownRow(els.sampleResult, "Delivery cost (courier)", money(o.delivery_cost));
    if (o.other_costs) breakdownRow(els.sampleResult, "Other costs", money(o.other_costs));
    breakdownRow(els.sampleResult, "You keep", money(o.net_kept)).className = "pr-keep";
  }

  /* ---------- unsaved-change tracking and the sticky bar ---------- */
  function differs(typed, saved) { return isNaN(typed) || Math.abs(typed - saved) > 1e-9; }

  function countChanges() {
    if (!base) return { total: 0 };
    var n = 0, first = null;
    var rateCard = els.commission.closest(".pr-card");
    var rateChanges = (differs(num(els.commission) / 100, base.commission_rate) ? 1 : 0) + (differs(num(els.fee) / 100, base.processor_fee_rate) ? 1 : 0) +
      (Number(els.step.value) !== base.rounding_step_ngn ? 1 : 0) + (els.passfee.checked !== base.pass_fee_on_delivery ? 1 : 0);
    if (rateCard) rateCard.classList.toggle("is-changed", rateChanges > 0);
    n += rateChanges;
    if (rateChanges && rateCard) first = rateCard;
    Object.keys(refs.products).forEach(function (id) {
      var ref = refs.products[id], saved = ref.saved;
      var c = (differs(num(ref.price), saved.price_ngn) ? 1 : 0) + (differs(num(ref.target), saved.target_net_ngn) ? 1 : 0) + (differs(num(ref.other), saved.other_cost_ngn || 0) ? 1 : 0);
      ref.card.classList.toggle("is-changed", c > 0);
      n += c;
      if (c && !first) first = ref.card;
    });
    Object.keys(refs.delivery).forEach(function (key) {
      var ref = refs.delivery[key], saved = base.delivery[key];
      var c = (differs(num(ref.courier), saved.courier_cost_ngn) ? 1 : 0) + (differs(num(ref.charge), saved.customer_charge_ngn) ? 1 : 0);
      ref.card.classList.toggle("is-changed", c > 0);
      n += c;
      if (c && !first) first = ref.card;
    });
    return { total: n, first: first };
  }

  function updateActionBar() {
    if (!els.actionbar) return;
    var c = countChanges();
    changeCount = c.total;
    els.actionbar.classList.toggle("has-changes", changeCount > 0);
    els.changesCount.textContent = changeCount === 0 ? "No unsaved changes" : changeCount + " unsaved change" + (changeCount === 1 ? "" : "s");
    els.review.disabled = changeCount === 0;
    els.discard.hidden = changeCount === 0;
    els.nextChange.hidden = changeCount === 0;
    measureBar();
  }

  /* The bar's height changes with the screen width and with which buttons are showing; the page padding,
     scroll-padding and the floating jump buttons all follow it through --actionbar-h. */
  function measureBar() {
    if (els.actionbar.hidden) return;
    document.documentElement.style.setProperty("--actionbar-h", els.actionbar.offsetHeight + "px");
  }

  function jumpToNextChange() {
    var cards = Array.prototype.slice.call(document.querySelectorAll("#pr-main .pr-card.is-changed"));
    if (!cards.length) return;
    var line = window.innerHeight * 0.3;
    var next = cards.filter(function (c) { return c.getBoundingClientRect().top > line + 4; })[0] || cards[0];
    next.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function discardChanges() {
    if (!changeCount || !window.confirm("Discard your " + changeCount + " unsaved change" + (changeCount === 1 ? "" : "s") + " and go back to the live values?")) return;
    build();
    setText(els.notice, "Changes discarded.", null);
  }

  /* ---------- review & save: a dialog over the page ---------- */
  function openModal() {
    els.diff.hidden = false;
    document.body.classList.add("has-modal");
    els.modalPanel.scrollTop = 0;
    els.modalPanel.focus();
  }

  function closeModal() {
    els.diff.hidden = true;
    document.body.classList.remove("has-modal");
    pendingInput = null;
    els.reviewBody.hidden = true;
    els.confirm.disabled = true;
    setText(els.saveStatus, "", null);
    if (els.review && !els.review.disabled) els.review.focus();
  }

  function syncConfirm() {
    els.confirm.disabled = !pendingInput || (!els.warn.hidden && !els.warnOk.checked);
  }

  /* ---------- saving ---------- */
  function readInput() {
    var x = rates();
    var input = {
      commission_rate: x.r,
      processor_fee_rate: x.f,
      rounding_step_ngn: step(),
      pass_fee_on_delivery: els.passfee.checked,
      products: {},
      delivery: {}
    };
    Object.keys(refs.products).forEach(function (id) {
      var ref = refs.products[id];
      input.products[id] = { price_ngn: num(ref.price), target_net_ngn: num(ref.target), other_cost_ngn: num(ref.other) };
    });
    Object.keys(refs.delivery).forEach(function (k) {
      input.delivery[k] = { courier_cost_ngn: num(refs.delivery[k].courier), customer_charge_ngn: num(refs.delivery[k].charge) };
    });
    var bad = false;
    (function scan(o) { Object.keys(o).forEach(function (k) { if (typeof o[k] === "number" && isNaN(o[k])) bad = true; else if (o[k] && typeof o[k] === "object") scan(o[k]); }); })(input);
    return bad ? null : input;
  }

  function belowRecommendation() {
    var below = [];
    Object.keys(refs.products).forEach(function (id) {
      var r = recommended(id);
      var price = num(refs.products[id].price);
      if (r !== null && !isNaN(price) && price < r) below.push(base.products[id].name + " " + base.products[id].size + ": " + money(price) + " is below the recommended " + money(r));
    });
    return below;
  }

  function review() {
    if (!changeCount) return;
    setText(els.saveStatus, "", null);
    els.reviewBody.hidden = true;
    els.confirm.disabled = true;
    pendingInput = null;
    var err = ratesError();
    if (err) { openModal(); setText(els.saveStatus, err, "error"); return; }
    var input = readInput();
    if (!input) { openModal(); setText(els.saveStatus, "Some fields are empty or not numbers. Please check them and try again.", "error"); return; }
    openModal();
    setText(els.saveStatus, "Checking…", null);
    post("preview", input).then(function (r) {
      if (r.status !== 200 || !r.data.ok) { setText(els.saveStatus, r.data.error || "Could not check the changes.", "error"); return; }
      setText(els.saveStatus, "", null);
      pendingInput = input;
      els.diffList.innerHTML = "";
      r.data.changes.forEach(function (line) { els.diffList.appendChild(el("li", "", line)); });
      var below = belowRecommendation();
      els.warnList.innerHTML = "";
      below.forEach(function (line) { els.warnList.appendChild(el("li", "", line)); });
      els.warn.hidden = below.length === 0;
      els.warnOk.checked = false;
      els.reviewBody.hidden = false;
      syncConfirm();
      els.confirm.focus();
    }).catch(function () { setText(els.saveStatus, "Could not reach the server.", "error"); });
  }

  function confirmSave() {
    if (!pendingInput || els.confirm.disabled) return;
    var input = pendingInput;
    input.note = els.note.value;
    input.expected_version = base.version;
    els.confirm.disabled = true;
    setText(els.saveStatus, "Saving…", null);
    post("save", input).then(function (r) {
      if (r.status === 200 && r.data.ok) {
        els.note.value = "";
        closeModal();
        setText(els.notice, "Saved as version " + r.data.version + ". New orders use it within about a minute.", "good");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return load();
      }
      syncConfirm();
      setText(els.saveStatus, r.data.error || "Could not save.", "error");
    }).catch(function () { syncConfirm(); setText(els.saveStatus, "Could not reach the server. Nothing was saved.", "error"); });
  }

  /* ---------- change log ---------- */
  function renderLog() {
    els.log.innerHTML = "";
    versions.forEach(function (v) {
      var li = el("li", "pr-log__item");
      var top = el("div", "pr-log__top");
      var title = el("strong", "", "Version " + v.version);
      top.appendChild(title);
      top.appendChild(el("span", "pr-log__when", dateText(v.created_at)));
      if (base && v.version === base.version) top.appendChild(el("span", "badge badge--ok", "live"));
      li.appendChild(top);
      if (v.note) li.appendChild(el("div", "pr-log__note", v.note));
      var ul = el("ul", "pr-log__changes");
      (v.changes || []).forEach(function (c) { ul.appendChild(el("li", "", c)); });
      li.appendChild(ul);
      if (base && v.version !== base.version && !v.built_in) {
        var rev = el("button", "btn btn--outline btn--sm", "Revert to this version");
        rev.type = "button";
        rev.addEventListener("click", function () { revert(v); });
        li.appendChild(rev);
      }
      els.log.appendChild(li);
    });
  }

  function revert(v) {
    if (!window.confirm("Revert to version " + v.version + "?\n\nThis saves a NEW version with the old prices and rates. Nothing is deleted, and new orders will use it within about a minute.")) return;
    post("revert_to", { version: v.version, expected_version: base.version }).then(function (r) {
      if (r.status === 200 && r.data.ok) {
        setText(els.notice, "Reverted: saved as version " + r.data.version + ".", "good");
        return load();
      }
      setText(els.notice, r.data.error || "Could not revert.", "error");
    }).catch(function () { setText(els.notice, "Could not reach the server.", "error"); });
  }

  /* ---------- loading ---------- */
  function load() {
    return post("get").then(function (r) {
      els.signin.disabled = false;
      if (r.status === 200 && r.data.ok) {
        base = r.data.config;
        versions = r.data.versions || [];
        els.gate.hidden = true;
        els.main.hidden = false;
        els.actionbar.hidden = false;
        document.body.classList.add("has-actionbar");
        document.documentElement.classList.add("has-actionbar");
        measureBar();   // scroll-padding: focus/scroll-into-view never lands under the bar
        build();
        renderLog();
        return;
      }
      setText(els.main.hidden ? els.gateStatus : els.notice, r.data.error || "Could not load pricing.", "error");   // signed in already: the gate is hidden, so say it up top
      if (els.main.hidden) password = "";
    }).catch(function () {
      els.signin.disabled = false;
      setText(els.main.hidden ? els.gateStatus : els.notice, "Could not reach the pricing service.", "error");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var $ = function (id) { return document.getElementById(id); };
    els.gate = $("pr-gate"); els.gateForm = $("pr-gate-form"); els.password = $("pr-password"); els.signin = $("pr-signin"); els.gateStatus = $("pr-gate-status");
    els.main = $("pr-main"); els.versionLine = $("pr-version-line"); els.notice = $("pr-notice"); els.reload = $("pr-reload");
    els.commission = $("pr-commission"); els.fee = $("pr-fee"); els.step = $("pr-step"); els.passfee = $("pr-passfee"); els.rateError = $("pr-rate-error");
    els.products = $("pr-products"); els.delivery = $("pr-delivery");
    els.sampleFields = $("pr-sample-fields"); els.sampleResult = $("pr-sample-result");
    els.note = $("pr-note"); els.review = $("pr-review"); els.saveStatus = $("pr-save-status");
    els.diff = $("pr-diff"); els.diffList = $("pr-diff-list"); els.confirm = $("pr-confirm"); els.cancel = $("pr-cancel");
    els.actionbar = $("pr-actionbar"); els.changesCount = $("pr-changes-count"); els.nextChange = $("pr-next-change"); els.discard = $("pr-discard");
    els.modalPanel = $("pr-modal-panel"); els.backdrop = $("pr-modal-backdrop"); els.reviewBody = $("pr-review-body");
    els.warn = $("pr-warn"); els.warnList = $("pr-warn-list"); els.warnOk = $("pr-warn-ok");
    els.log = $("pr-log");
    if (!els.gateForm) return;

    els.gateForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!els.gateForm.checkValidity()) { els.gateForm.reportValidity(); return; }
      password = els.password.value;
      els.signin.disabled = true;
      setText(els.gateStatus, "Loading…", null);
      load();
    });
    els.reload.addEventListener("click", function () {
      if (changeCount && !window.confirm("Reloading discards your " + changeCount + " unsaved change" + (changeCount === 1 ? "" : "s") + ". Continue?")) return;
      setText(els.notice, "", null); closeModal(); load();
    });
    [els.commission, els.fee, els.step, els.passfee].forEach(function (n) { n.addEventListener(n === els.step || n === els.passfee ? "change" : "input", recalc); });
    els.review.addEventListener("click", review);
    els.confirm.addEventListener("click", confirmSave);
    els.cancel.addEventListener("click", closeModal);
    els.backdrop.addEventListener("click", closeModal);
    els.warnOk.addEventListener("change", syncConfirm);
    els.nextChange.addEventListener("click", jumpToNextChange);
    els.discard.addEventListener("click", discardChanges);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !els.diff.hidden) closeModal();
      else if (e.key === "Tab" && !els.diff.hidden) {                       // keep keyboard focus inside the dialog
        var f = Array.prototype.slice.call(els.modalPanel.querySelectorAll("button, input, [href]")).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === els.modalPanel)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    window.addEventListener("resize", measureBar);
    window.addEventListener("beforeunload", function (e) { if (changeCount) { e.preventDefault(); e.returnValue = ""; } });
  });
})();
