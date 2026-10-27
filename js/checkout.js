/* =========================================================
   XNY Farms Limited — Cart page + Checkout (cart.html only)
   Renders the cart, computes delivery + totals, and drives
   Flutterwave's Inline Checkout JS SDK client-side.

   IMPORTANT — this is a static site with NO backend/server, so:
   - Only the Flutterwave PUBLIC key is used here. It is safe to
     ship in client-side code by design.
   - The Flutterwave SECRET key must NEVER be added to this file,
     any other file in this repo, or any client-side code. It is
     only ever used server-side.
   - A successful payment is currently confirmed purely from the
     client-side callback below. That is enough to accept real
     payments and notify the business by email, but it is NOT
     server-verified — see the "Payments & Security" section in
     README.md for what that means and the recommended fast-follow
     (a small Cloudflare Pages Function that calls Flutterwave's
     Verify Transaction API with the secret key, server-side).
   ========================================================= */
(function () {
  "use strict";

  // ---- Prices and delivery charges --------------------------------------
  // They are NOT constants any more: they come from /api/pricing (js/pricing.js), set by the admin
  // on admin-pricing.html. The last-known defaults in js/pricing.js are for DISPLAY only; this file
  // refuses to open the payment window unless the prices came from the server (see requireLivePrices).
  var pricing = window.XNYPricing;

  // ---- Pickup ------------------------------------------------------
  // Customers can collect from the distribution point instead of paying
  // for delivery. Free, so it carries no rate constant.
  var PICKUP_ADDRESS = "1-3 Adebakin Close, Santos Layout, Akowonjo, Alimosho, Lagos";

  // ---- Flutterwave ----------------------------------------------------
  // Public key only — paste your real Flutterwave PUBLIC key below.
  // Never put the secret key here.
  var FLUTTERWAVE_PUBLIC_KEY = "FLWPUBK-a3e668407ea4d1608e40f8bac749ff69-X";

  // Payment methods offered inside the Flutterwave modal. A single
  // comma-separated string — per Flutterwave's own SDK typings
  // (flutterwave-react-v3):
  //   "This specifies the payment options to be displayed
  //    e.g - [card, mobilemoney, ussd] and so on.
  //    Defaults to 'card, ussd, mobilemoney'"
  //
  // QR PAYMENTS — CONFIRMED. Flutterwave's QR product is NIBSS QR, and the
  // token is "nqr", lowercase, per their payment-methods documentation:
  //   https://developer.flutterwave.com/v3.0/docs/payment-methods
  // (An earlier note here flagged this as unverified because that domain is
  // unreachable from the environment this was written in; it was since
  // confirmed against the docs directly.) NQR is also confirmed Enabled on
  // the live merchant account — Settings → Business preference → Payment
  // methods — as of 2026-09-29.
  //
  // One dashboard setting still governs whether this string is honoured at
  // all: Flutterwave only applies payment_options when "Enable Dashboard
  // Payment Options" is UNCHECKED in Account Settings. With it on, the
  // dashboard's own selection wins and everything below is ignored. So if a
  // method listed here doesn't appear in the modal, check that first.
  //
  // Note the typings are `'card, ussd, mobilemoney' | string` — they
  // enumerate nothing, so a mistyped token fails silently rather than
  // erroring. Verify any change against a real checkout.
  var PAYMENT_OPTIONS = "card, banktransfer, ussd, nqr";

  // Holds the chosen fulfilment option: "pickup" | "lagos" | "other".
  // Key name kept from when the choice was delivery-only, so a shopper
  // who picked a delivery zone before pickup existed keeps their choice.
  var FULFILMENT_STORAGE_KEY = "xny_delivery_state";

  var cart = window.XNYCart;
  if (!cart || !pricing) return;

  var els = {};
  var paymentSettled = false;

  function cacheEls() {
    els.empty = document.getElementById("cart-empty");
    els.content = document.getElementById("cart-content");
    els.items = document.getElementById("cart-items");
    els.subtotal = document.getElementById("cart-subtotal");
    els.delivery = document.getElementById("cart-delivery");
    els.deliveryLabel = document.getElementById("cart-delivery-label");
    els.total = document.getElementById("cart-total");
    els.deliveryRadios = document.querySelectorAll("[data-delivery-radio]");
    els.rateLagos = document.querySelectorAll("[data-rate-lagos]");
    els.rateOther = document.querySelectorAll("[data-rate-other]");
    els.pickupNote = document.getElementById("pickup-note");
    els.addressField = document.getElementById("co-address-field");
    els.addressInput = document.getElementById("co-address");
    els.pickupCheckoutNote = document.getElementById("pickup-checkout-note");
    els.proceedBtn = document.getElementById("proceed-checkout-btn");
    els.checkoutSection = document.getElementById("checkout-section");
    els.checkoutForm = document.getElementById("checkout-form");
    els.payBtn = document.getElementById("pay-now-btn");
    els.payAmount = document.getElementById("pay-now-amount");
    els.checkoutStatus = document.getElementById("checkout-status");
    els.confirmation = document.getElementById("order-confirmation");
    els.confirmationRef = document.getElementById("confirmation-ref");
    els.confirmationNote = document.getElementById("confirmation-note");
    els.confirmationMain = document.getElementById("confirmation-main");
    els.pricingError = document.getElementById("pricing-error");
    els.pricingRetry = document.getElementById("pricing-retry");
    els.priceNotice = document.getElementById("cart-price-notice");
  }

  function money(n) {
    return "₦" + Math.round(n).toLocaleString("en-NG");
  }

  function getFulfilment() {
    try { return window.localStorage.getItem(FULFILMENT_STORAGE_KEY) || ""; }
    catch (e) { return ""; }
  }

  function setFulfilment(value) {
    try { window.localStorage.setItem(FULFILMENT_STORAGE_KEY, value); }
    catch (e) { /* not fatal — the choice just won't persist */ }
  }

  function isPickup() {
    return getFulfilment() === "pickup";
  }

  function getDeliveryFee() {
    var choice = getFulfilment();
    if (choice === "lagos") return pricing.getDelivery("lagos");
    if (choice === "other") return pricing.getDelivery("other");
    return 0; // pickup, or nothing chosen yet
  }

  // Human-readable fulfilment method, used in the summary and in the
  // order-notification email.
  function getFulfilmentLabel() {
    var choice = getFulfilment();
    if (choice === "pickup") return "Pickup (free)";
    if (choice === "lagos") return "Delivery — Lagos";
    if (choice === "other") return "Delivery — Other Nigerian States";
    return "Not selected";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function renderItems() {
    var items = cart.readCart();

    if (items.length === 0) {
      els.empty.style.display = "";
      els.content.style.display = "none";
      return;
    }
    els.empty.style.display = "none";
    els.content.style.display = "";

    els.items.innerHTML = "";
    items.forEach(function (item) {
      var product = cart.PRODUCTS[item.id] || {};
      var row = document.createElement("div");
      row.className = "cart-item";
      row.innerHTML =
        '<div class="cart-item__media"><img src="' + escapeHtml(product.image || "") + '" alt="' + escapeHtml(item.name + " — " + item.size) + '" /></div>' +
        '<div class="cart-item__body">' +
          "<h3>" + escapeHtml(item.name + " — " + item.size) + "</h3>" +
          '<div class="cart-item__meta">' + money(item.price) + " each</div>" +
          '<div class="cart-item__qty">' +
            '<button type="button" class="qty-btn" data-qty-decrease="' + escapeHtml(item.id) + '" aria-label="Decrease quantity">−</button>' +
            '<span class="cart-item__qty-value">' + item.qty + "</span>" +
            '<button type="button" class="qty-btn" data-qty-increase="' + escapeHtml(item.id) + '" aria-label="Increase quantity">+</button>' +
          "</div>" +
          '<button type="button" class="cart-item__remove" data-remove-item="' + escapeHtml(item.id) + '">Remove</button>' +
        "</div>" +
        '<div class="cart-item__price">' + money(item.price * item.qty) + "</div>";
      els.items.appendChild(row);
    });

    els.items.querySelectorAll("[data-qty-increase]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-qty-increase");
        var item = cart.readCart().filter(function (i) { return i.id === id; })[0];
        if (item) cart.updateQty(id, item.qty + 1);
        renderItems();
        renderTotals();
      });
    });
    els.items.querySelectorAll("[data-qty-decrease]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-qty-decrease");
        var item = cart.readCart().filter(function (i) { return i.id === id; })[0];
        if (item) cart.updateQty(id, item.qty - 1);
        renderItems();
        renderTotals();
      });
    });
    els.items.querySelectorAll("[data-remove-item]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        cart.removeItem(btn.getAttribute("data-remove-item"));
        renderItems();
        renderTotals();
      });
    });
  }

  // The Lagos / Other States prices shown next to the radios come from
  // the rate constants above, so the labels can never drift out of sync
  // with what's actually charged.
  function renderRates() {
    els.rateLagos.forEach(function (el) { el.textContent = money(pricing.getDelivery("lagos")); });
    els.rateOther.forEach(function (el) { el.textContent = money(pricing.getDelivery("other")); });
  }

  function renderTotals() {
    var subtotal = cart.getSubtotal();
    var deliveryFee = getDeliveryFee();
    var total = subtotal + deliveryFee;
    els.subtotal.textContent = money(subtotal);

    if (isPickup()) {
      els.deliveryLabel.textContent = "Pickup";
      els.delivery.textContent = "Free";
    } else {
      els.deliveryLabel.textContent = "Delivery";
      els.delivery.textContent = deliveryFee ? money(deliveryFee) : "— (choose an option below)";
    }

    els.total.textContent = money(total);
    if (els.payAmount) els.payAmount.textContent = money(total);
    renderedSignature = priceSignature();
  }

  /* What the shopper is looking at: the pricing version, the subtotal and the delivery charge. Compared
     again right before payment so the amount charged is always the amount shown. */
  var renderedSignature = "";
  function priceSignature() {
    return [pricing.getVersion(), cart.getSubtotal(), getDeliveryFee()].join("|");
  }

  /* ---- live prices: loading, notices, and blocking payment when they can't be loaded ---- */
  function setPaymentBlocked(blocked) {
    [els.proceedBtn, els.payBtn].forEach(function (btn) { if (btn) btn.disabled = blocked; });
  }

  function showPricingError(show) {
    if (els.pricingError) els.pricingError.hidden = !show;
    setPaymentBlocked(show);
  }

  function showPriceNotice(show) {
    if (els.priceNotice) els.priceNotice.hidden = !show;
  }

  function redraw() {
    renderItems();
    renderRates();
    renderTotals();
  }

  /* Called whenever a price fetch finishes. Success: redraw with the real prices, tell the shopper if
     they changed since they added things, unblock payment. Failure: keep drawing the defaults but block
     payment and offer a retry. */
  function onPricing() {
    if (pricing.isLive()) {
      var changed = cart.checkRepricing();
      redraw();
      showPriceNotice(changed);
      showPricingError(false);
    } else {
      showPricingError(true);
    }
  }

  function retryPricing() {
    if (els.pricingRetry) els.pricingRetry.disabled = true;
    return pricing.load(true).then(function () {
      if (els.pricingRetry) els.pricingRetry.disabled = false;
      onPricing();
    });
  }

  /* Right before a payment: fetch the prices fresh (no cache). Resolves true only if they came from the
     server AND nothing the shopper is looking at has changed. Otherwise it explains and resolves false,
     so a stale or default price can never be charged. */
  function requireLivePrices() {
    return pricing.load(true).then(function () {
      if (!pricing.isLive()) {
        showPricingError(true);
        els.checkoutStatus.textContent = "We couldn't load today's prices, so payment is paused. Please check your connection and try again.";
        els.checkoutStatus.style.color = "#b23b2e";
        return false;
      }
      var before = renderedSignature;
      cart.checkRepricing();
      redraw();
      showPricingError(false);
      if (before !== renderedSignature) {
        showPriceNotice(true);
        els.checkoutStatus.textContent = "Prices were updated. Please check your new total, then press Pay Now again.";
        els.checkoutStatus.style.color = "#b23b2e";
        return false;
      }
      return true;
    });
  }

  // Pickup needs no shipping address, so the address field is hidden and
  // un-required for it (a hidden field left `required` would silently
  // block form validation), and a pickup reminder is shown instead.
  function applyFulfilmentUi() {
    var pickup = isPickup();

    if (els.pickupNote) els.pickupNote.hidden = !pickup;
    if (els.pickupCheckoutNote) els.pickupCheckoutNote.hidden = !pickup;

    if (els.addressField && els.addressInput) {
      els.addressField.hidden = pickup;
      els.addressInput.required = !pickup;
      if (pickup) els.addressInput.value = "";
    }
  }

  function initDeliveryRadios() {
    var saved = getFulfilment();
    els.deliveryRadios.forEach(function (radio) {
      if (radio.value === saved) radio.checked = true;
      radio.addEventListener("change", function () {
        setFulfilment(radio.value);
        renderTotals();
        applyFulfilmentUi();
      });
    });
  }

  function initProceed() {
    if (!els.proceedBtn) return;
    els.proceedBtn.addEventListener("click", function () {
      if (cart.readCart().length === 0) return;
      if (!getFulfilment()) {
        window.alert("Please choose pickup or a delivery option before proceeding to checkout.");
        return;
      }
      els.checkoutSection.style.display = "";
      els.checkoutSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  /* The business is notified by the SERVER, and only once Flutterwave has confirmed the payment
     (see /api/verify-order). Nothing is opened in the customer's email app any more, and the browser
     no longer reports sales: it can't be trusted to. */
  function showConfirmation(order, note) {
    els.content.style.display = "none";
    els.empty.style.display = "none"; // cart is now empty, but show the receipt, not "cart is empty"
    els.confirmation.style.display = "";
    els.confirmationRef.textContent = order.txRef;
    if (els.confirmationNote) els.confirmationNote.textContent = note || "";
    if (note && els.confirmationMain) els.confirmationMain.textContent = "We\u2019ve received your order and your payment details.";
    els.confirmation.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* After the Flutterwave window reports success, ask OUR server to confirm it with Flutterwave.
     "paid" -> confirmation. "pending"/"unverified" (the provider hasn't confirmed yet) -> retry a few
     times, then show the receipt with a note, since the webhook will confirm it. "underpaid"/"failed"
     -> explain, keep the cart, and tell them to contact us. */
  function confirmPayment(order) {
    var attempts = 0;
    var delays = [0, 2500, 4000, 6000];
    els.checkoutStatus.textContent = "Confirming your payment…";
    els.checkoutStatus.style.color = "var(--muted)";

    function attempt() {
      window.fetch("/api/verify-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tx_ref: order.txRef })
      })
        .then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (r) {
          var state = r && r.state;
          if (state === "paid") {
            cart.clearCart();
            els.checkoutStatus.textContent = "";
            showConfirmation(order, "");
            return;
          }
          if (state === "underpaid" || state === "failed" || state === "unknown") {
            els.checkoutStatus.innerHTML = "";
            els.checkoutStatus.textContent =
              "We couldn't match your payment to this order (reference " + order.txRef + "). Please contact us at xnyfarms@gmail.com or +234 806 013 8299 and quote that reference. Your cart has been kept.";
            els.checkoutStatus.style.color = "#b23b2e";
            return;
          }
          // pending / unverified / a transport error: try again a few times
          attempts += 1;
          if (attempts < delays.length) {
            window.setTimeout(attempt, delays[attempts]);
            return;
          }
          cart.clearCart();
          els.checkoutStatus.textContent = "";
          showConfirmation(order,
            "Your payment is being confirmed with our payment provider, which can take a few minutes. " +
            "You don't need to do anything: we'll process your order as soon as it is confirmed. " +
            "If you don't hear from us within a few hours, please contact us and quote the reference above.");
        })
        .catch(function () {
          attempts += 1;
          if (attempts < delays.length) { window.setTimeout(attempt, delays[attempts]); return; }
          cart.clearCart();
          showConfirmation(order, "We couldn't reach our server to confirm your payment just now. It will be confirmed automatically; please contact us if you don't hear from us within a few hours, and quote the reference above.");
        });
    }
    attempt();
  }

  function initPayNow() {
    if (!els.payBtn) return;
    els.payBtn.addEventListener("click", function () {
      if (cart.readCart().length === 0) return;

      if (!els.checkoutForm.checkValidity()) {
        els.checkoutForm.reportValidity();
        return;
      }
      if (!getFulfilment()) {
        window.alert("Please choose pickup or a delivery option before paying.");
        return;
      }

      els.payBtn.disabled = true;
      els.checkoutStatus.textContent = "Checking today's prices…";
      els.checkoutStatus.style.color = "var(--muted)";
      requireLivePrices().then(function (ok) {
        els.payBtn.disabled = pricing.isLive() ? false : true;
        if (ok) startPayment();
      });
    });
  }

  /* Step 1 of paying: the SERVER prices the cart and creates the order. The window is then opened with
     the tx_ref and amount the server returns, never with a total worked out in this page. If the server's
     total differs from what the shopper was shown (prices moved), nothing is charged: they are told. */
  function startPayment() {
    if (typeof FlutterwaveCheckout !== "function") {
      els.checkoutStatus.textContent =
        "Payment system failed to load. Please refresh and try again, or contact us directly to place your order.";
      els.checkoutStatus.style.color = "#b23b2e";
      return;
    }
    if (FLUTTERWAVE_PUBLIC_KEY.indexOf("YOUR_FLUTTERWAVE_PUBLIC_KEY") === 0) {
      els.checkoutStatus.textContent =
        "Online payment isn't configured on this site yet. Please contact us directly to place your order.";
      els.checkoutStatus.style.color = "#b23b2e";
      return;
    }

    var form = els.checkoutForm;
    var displayedTotal = cart.getSubtotal() + getDeliveryFee();
    els.payBtn.disabled = true;
    els.checkoutStatus.textContent = "Securing your order…";
    els.checkoutStatus.style.color = "var(--muted)";

    window.fetch("/api/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.getOrderLines(),
        fulfilment: getFulfilment(),
        customer: { name: form.elements.name.value, email: form.elements.email.value, phone: form.elements.phone.value, address: form.elements.address.value },
        ref_code: window.XNYReferral ? window.XNYReferral.getRefCode() : null
      })
    })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { status: res.status, data: d }; }); })
      .then(function (r) {
        els.payBtn.disabled = false;
        var d = r.data || {};
        if (r.status !== 200 || !d.ok) {
          els.checkoutStatus.textContent = d.error || "We couldn't start your payment. Please try again.";
          els.checkoutStatus.style.color = "#b23b2e";
          return;
        }
        if (Math.abs(d.amount - displayedTotal) > 0.005) {
          // The server's price is the real one. Show it and ask the shopper to confirm.
          pricing.load(true).then(function () {
            cart.checkRepricing();
            redraw();
            showPriceNotice(true);
            els.checkoutStatus.textContent = "Prices were updated. Please check your new total, then press Pay Now again.";
            els.checkoutStatus.style.color = "#b23b2e";
          });
          return;
        }
        openPayment(d);
      })
      .catch(function () {
        els.payBtn.disabled = false;
        els.checkoutStatus.textContent = "We couldn't reach our server. Please check your connection and try again.";
        els.checkoutStatus.style.color = "#b23b2e";
      });
  }

  /* Step 2: open Flutterwave with exactly what the server created. */
  function openPayment(serverOrder) {
    var form = els.checkoutForm;
    var txRef = serverOrder.tx_ref;
    var order = { txRef: txRef, total: serverOrder.amount };
    paymentSettled = false;
    els.checkoutStatus.textContent = "Opening secure payment window…";
    els.checkoutStatus.style.color = "var(--muted)";

    FlutterwaveCheckout({
      public_key: FLUTTERWAVE_PUBLIC_KEY,
      tx_ref: txRef,
      amount: serverOrder.amount,
      currency: serverOrder.currency || "NGN",
      payment_options: PAYMENT_OPTIONS,
      customer: {
        email: form.elements.email.value,
        phone_number: form.elements.phone.value,
        name: form.elements.name.value
      },
      customizations: {
        title: "XNY Farms Limited",
        description: "Order payment — XNY Farms Limited",
        logo: window.location.origin + "/assets/xny-logo.png"
      },
      callback: function (response) {
        paymentSettled = true;
        var ok = response && (response.status === "successful" || response.status === "completed");
        if (ok) {
          // The window says it paid. That is only a hint: the server confirms it with Flutterwave.
          confirmPayment(order);
        } else {
          els.checkoutStatus.textContent =
            "Payment was not completed (status: " + (response && response.status ? response.status : "unknown") +
            "). Your cart is still saved — please try again.";
          els.checkoutStatus.style.color = "#b23b2e";
        }
      },
      onclose: function () {
        if (!paymentSettled) {
          els.checkoutStatus.textContent =
            "Checkout was closed before payment finished. Your cart is still saved — you can try again anytime.";
          els.checkoutStatus.style.color = "#b23b2e";
        }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    cacheEls();
    renderItems();
    renderRates();
    initDeliveryRadios();
    renderTotals();
    applyFulfilmentUi();
    initProceed();
    initPayNow();
    if (els.pricingRetry) els.pricingRetry.addEventListener("click", retryPricing);

    // Until today's prices arrive, payment is held: the page is drawn from last-known defaults.
    showPricingError(false);
    setPaymentBlocked(true);
    pricing.load(false).then(onPricing);
  });
})();
