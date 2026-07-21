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

  // ---- Flutterwave ----------------------------------------------------
  // Public key only — paste your real Flutterwave PUBLIC key below.
  // Never put the secret key here.
  var FLUTTERWAVE_PUBLIC_KEY = "YOUR_FLUTTERWAVE_PUBLIC_KEY_HERE";

  var ORDER_NOTIFICATION_EMAIL = "xnyfarms@gmail.com";
  var DELIVERY_STORAGE_KEY = "xny_delivery_state";

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
    els.total = document.getElementById("cart-total");
    els.deliveryRadios = document.querySelectorAll("[data-delivery-radio]");
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

  function getDeliveryState() {
    try { return window.localStorage.getItem(DELIVERY_STORAGE_KEY) || ""; }
    catch (e) { return ""; }
  }

  function setDeliveryState(value) {
    try { window.localStorage.setItem(DELIVERY_STORAGE_KEY, value); }
    catch (e) { /* not fatal — delivery choice just won't persist */ }
  }

  function getDeliveryFee() {
    var state = getDeliveryState();
    if (state === "lagos") return DELIVERY_RATE_LAGOS;
    if (state === "other") return DELIVERY_RATE_OTHER;
    return 0;
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

  function renderTotals() {
    var subtotal = cart.getSubtotal();
    var deliveryFee = getDeliveryFee();
    var total = subtotal + deliveryFee;
    els.subtotal.textContent = money(subtotal);
    els.delivery.textContent = deliveryFee ? money(deliveryFee) : "— (choose delivery below)";
    els.total.textContent = money(total);
    if (els.payAmount) els.payAmount.textContent = money(total);
  }

  function initDeliveryRadios() {
    var saved = getDeliveryState();
    els.deliveryRadios.forEach(function (radio) {
      if (radio.value === saved) radio.checked = true;
      radio.addEventListener("change", function () {
        setDeliveryState(radio.value);
        renderTotals();
      });
    });
  }

  function initProceed() {
    if (!els.proceedBtn) return;
    els.proceedBtn.addEventListener("click", function () {
      if (cart.readCart().length === 0) return;
      if (!getDeliveryState()) {
        window.alert("Please choose a delivery location before proceeding to checkout.");
        return;
      }
      els.checkoutSection.style.display = "";
      els.checkoutSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function buildOrderEmailBody(txRef, status) {
    var items = cart.readCart();
    var itemLines = items.map(function (item) {
      return "- " + item.name + " (" + item.size + ") x " + item.qty + " = " + money(item.price * item.qty);
    });
    var subtotal = cart.getSubtotal();
    var deliveryFee = getDeliveryFee();
    var total = subtotal + deliveryFee;
    var stateLabel = getDeliveryState() === "lagos" ? "Lagos" : "Other Nigerian States";
    var form = els.checkoutForm;

    var lines = [
      "Order reference (Flutterwave tx_ref): " + txRef,
      "Payment status (as reported client-side): " + status,
      "",
      "Customer: " + form.elements.name.value,
      "Email: " + form.elements.email.value,
      "Phone: " + form.elements.phone.value,
      "Delivery address: " + form.elements.address.value,
      "Delivery location: " + stateLabel,
      "",
      "Items:"
    ]
      .concat(itemLines)
      .concat([
        "",
        "Subtotal: " + money(subtotal),
        "Delivery: " + money(deliveryFee),
        "Total: " + money(total),
        "",
        "Please verify this payment in the Flutterwave dashboard " +
          "(dashboard.flutterwave.com) before dispatching this order."
      ]);
    return lines.join("\n");
  }

  function sendConfirmationEmail(txRef, status) {
    var subject = encodeURIComponent("New Order — XNY Farms (" + txRef + ")");
    var body = encodeURIComponent(buildOrderEmailBody(txRef, status));
    window.location.href = "mailto:" + ORDER_NOTIFICATION_EMAIL + "?subject=" + subject + "&body=" + body;
  }

  function showConfirmation(txRef) {
    els.content.style.display = "none";
    els.confirmation.style.display = "";
    els.confirmationRef.textContent = txRef;
    els.confirmation.scrollIntoView({ behavior: "smooth", block: "start" });

    els.resendEmailBtn.onclick = function () {
      sendConfirmationEmail(txRef, "successful");
    };

    // Fire the order-notification email automatically so the business
    // doesn't depend on the customer remembering to click "resend" —
    // but the button above still exists in case the mail client didn't
    // open (e.g. the visitor closed the tab too quickly).
    sendConfirmationEmail(txRef, "successful");
  }

  function initPayNow() {
    if (!els.payBtn) return;
    els.payBtn.addEventListener("click", function () {
      if (cart.readCart().length === 0) return;

      if (!els.checkoutForm.checkValidity()) {
        els.checkoutForm.reportValidity();
        return;
      }
      if (!getDeliveryState()) {
        window.alert("Please choose a delivery location before paying.");
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
            cart.clearCart();
            showConfirmation(txRef);
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
    initDeliveryRadios();
    renderTotals();
    initProceed();
    initPayNow();
  });
})();
