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

  // ---- Delivery rates (NGN) ----------------------------------------
  // PROVISIONAL flat rates — placeholders until a courier partner and
  // real zone pricing are confirmed. Update these two constants when
  // that happens; nothing else in this file needs to change.
  var DELIVERY_RATE_LAGOS = 1500; // NGN — placeholder, update once a courier partner is confirmed
  var DELIVERY_RATE_OTHER = 3500; // NGN — placeholder, update once a courier partner is confirmed

  // ---- Pickup ------------------------------------------------------
  // Customers can collect from the distribution point instead of paying
  // for delivery. Free, so it carries no rate constant.
  var PICKUP_ADDRESS = "1-3 Adebakin Close, Santos Layout, Akowonjo, Alimosho, Lagos";

  // ---- Flutterwave ----------------------------------------------------
  // Public key only — paste your real Flutterwave PUBLIC key below.
  // Never put the secret key here.
  var FLUTTERWAVE_PUBLIC_KEY = "FLWPUBK-a3e668407ea4d1608e40f8bac749ff69-X";

  var ORDER_NOTIFICATION_EMAIL = "xnyfarms@gmail.com";
  // Holds the chosen fulfilment option: "pickup" | "lagos" | "other".
  // Key name kept from when the choice was delivery-only, so a shopper
  // who picked a delivery zone before pickup existed keeps their choice.
  var FULFILMENT_STORAGE_KEY = "xny_delivery_state";

  var cart = window.XNYCart;
  if (!cart) return;

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
    els.resendEmailBtn = document.getElementById("resend-email-btn");
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
    if (choice === "lagos") return DELIVERY_RATE_LAGOS;
    if (choice === "other") return DELIVERY_RATE_OTHER;
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
    els.rateLagos.forEach(function (el) { el.textContent = money(DELIVERY_RATE_LAGOS); });
    els.rateOther.forEach(function (el) { el.textContent = money(DELIVERY_RATE_OTHER); });
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

  // Snapshot everything the notification email needs WHILE the cart and
  // form still hold the order. This must be taken before cart.clearCart()
  // runs on success — otherwise the email is built from an emptied cart
  // and reaches the business with no items and a zero total. The snapshot
  // is also what the "resend" button replays, so it stays correct however
  // long after the cart was cleared it's pressed.
  function captureOrder(txRef, status) {
    var form = els.checkoutForm;
    var subtotal = cart.getSubtotal();
    var deliveryFee = getDeliveryFee();
    return {
      txRef: txRef,
      status: status,
      items: cart.readCart(),
      subtotal: subtotal,
      deliveryFee: deliveryFee,
      total: subtotal + deliveryFee,
      pickup: isPickup(),
      fulfilmentLabel: getFulfilmentLabel(),
      name: form.elements.name.value,
      email: form.elements.email.value,
      phone: form.elements.phone.value,
      address: form.elements.address.value
    };
  }

  function buildOrderEmailBody(order) {
    var itemLines = order.items.map(function (item) {
      return "- " + item.name + " (" + item.size + ") x " + item.qty + " = " + money(item.price * item.qty);
    });

    var lines = [
      "Order reference (Flutterwave tx_ref): " + order.txRef,
      "Payment status (as reported client-side): " + order.status,
      "",
      "Fulfilment method: " + order.fulfilmentLabel,
      order.pickup
        ? "Pickup location: " + PICKUP_ADDRESS
        : "Delivery address: " + order.address,
      "",
      "Customer: " + order.name,
      "Email: " + order.email,
      "Phone: " + order.phone,
      "",
      "Items:"
    ]
      .concat(itemLines)
      .concat([
        "",
        "Subtotal: " + money(order.subtotal),
        order.pickup ? "Pickup: Free" : "Delivery: " + money(order.deliveryFee),
        "Total: " + money(order.total),
        "",
        order.pickup
          ? "This is a PICKUP order — the customer will collect from " + PICKUP_ADDRESS + "."
          : "This order is for delivery.",
        "",
        "Please verify this payment in the Flutterwave dashboard " +
          "(dashboard.flutterwave.com) before " +
          (order.pickup ? "releasing this order." : "dispatching this order.")
      ]);
    return lines.join("\n");
  }

  function sendConfirmationEmail(order) {
    var subject = encodeURIComponent("New Order — XNY Farms (" + order.txRef + ")");
    var body = encodeURIComponent(buildOrderEmailBody(order));
    window.location.href = "mailto:" + ORDER_NOTIFICATION_EMAIL + "?subject=" + subject + "&body=" + body;
  }

  function showConfirmation(order) {
    els.content.style.display = "none";
    els.empty.style.display = "none"; // cart is now empty, but show the receipt, not "cart is empty"
    els.confirmation.style.display = "";
    els.confirmationRef.textContent = order.txRef;
    els.confirmation.scrollIntoView({ behavior: "smooth", block: "start" });

    els.resendEmailBtn.onclick = function () {
      sendConfirmationEmail(order);
    };

    // Fire the order-notification email automatically so the business
    // doesn't depend on the customer remembering to click "resend" —
    // but the button above still exists in case the mail client didn't
    // open (e.g. the visitor closed the tab too quickly).
    sendConfirmationEmail(order);
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

      var subtotal = cart.getSubtotal();
      var deliveryFee = getDeliveryFee();
      var total = subtotal + deliveryFee;
      var txRef = "xny-" + Date.now();
      var form = els.checkoutForm;
      paymentSettled = false;

      els.checkoutStatus.textContent = "Opening secure payment window…";
      els.checkoutStatus.style.color = "var(--muted)";

      FlutterwaveCheckout({
        public_key: FLUTTERWAVE_PUBLIC_KEY,
        tx_ref: txRef,
        amount: total,
        currency: "NGN",
        payment_options: "card, banktransfer, ussd",
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
          if (response && response.status === "successful") {
            // Snapshot first — clearCart() below empties the source data.
            var order = captureOrder(txRef, "successful");
            cart.clearCart();
            showConfirmation(order);
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
  });
})();
