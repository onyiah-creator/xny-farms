/* =========================================================
   XNY Farms Limited — Cart core
   Client-side cart persisted in localStorage (this is a real
   deployed static site, not a preview sandbox, so localStorage
   is appropriate here). No backend — nothing here talks to a
   server. Shared by every page: powers the header cart badge
   and the "Add to Cart" buttons on products.html / index.html.
   Cart-page rendering + Flutterwave checkout live in
   js/checkout.js (cart.html only).
   ========================================================= */
(function (window) {
  "use strict";

  var STORAGE_KEY = "xny_cart";

  // Central product catalog — id -> display + pricing data, looked
  // up by the "Add to Cart" buttons via their data-add-to-cart
  // attribute. Keep prices here in sync with what's shown on
  // products.html / index.html.
  var PRODUCTS = {
    "ashe-honey-50cl": { name: "ASHE Honey", size: "50cl", price: 6500, image: "assets/ashe-honey-50cl.png" },
    "ashe-honey-1l": { name: "ASHE Honey", size: "1 Litre", price: 12000, image: "assets/ashe-honey-1l.png" },
    "palm-oil-50cl": { name: "Palm Oil", size: "50cl", price: 700, image: "assets/palm-oil-50cl.png" },
    "palm-oil-1l": { name: "Palm Oil", size: "1 Litre", price: 1300, image: "assets/palm-oil-1l.png" }
  };

  function readCart() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var cart = raw ? JSON.parse(raw) : [];
      return Array.isArray(cart) ? cart : [];
    } catch (e) {
      return [];
    }
  }

  function writeCart(cart) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch (e) {
      /* localStorage unavailable (private browsing, quota, etc.) —
         cart just won't persist across page loads. */
    }
    updateBadge();
  }

  function addItem(id, qty) {
    qty = qty || 1;
    var product = PRODUCTS[id];
    if (!product) return;
    var cart = readCart();
    var existing = null;
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].id === id) { existing = cart[i]; break; }
    }
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ id: id, name: product.name, size: product.size, price: product.price, qty: qty });
    }
    writeCart(cart);
  }

  function updateQty(id, qty) {
    var cart = readCart();
    var next = [];
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].id === id) {
        if (qty > 0) {
          cart[i].qty = qty;
          next.push(cart[i]);
        }
        // qty <= 0 drops the item from the cart entirely.
      } else {
        next.push(cart[i]);
      }
    }
    writeCart(next);
  }

  function removeItem(id) {
    var cart = readCart().filter(function (item) { return item.id !== id; });
    writeCart(cart);
  }

  function clearCart() {
    writeCart([]);
  }

  function getSubtotal(cart) {
    cart = cart || readCart();
    var sum = 0;
    for (var i = 0; i < cart.length; i++) sum += cart[i].price * cart[i].qty;
    return sum;
  }

  function getItemCount(cart) {
    cart = cart || readCart();
    var sum = 0;
    for (var i = 0; i < cart.length; i++) sum += cart[i].qty;
    return sum;
  }

  function updateBadge() {
    var count = getItemCount();
    var badges = document.querySelectorAll("[data-cart-count]");
    badges.forEach(function (el) {
      el.textContent = String(count);
      el.hidden = count === 0;
    });
  }

  function initAddToCartButtons() {
    document.querySelectorAll("[data-add-to-cart]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-add-to-cart");
        addItem(id, 1);
        var originalText = btn.textContent;
        btn.textContent = "Added ✓";
        btn.disabled = true;
        window.setTimeout(function () {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 1100);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    updateBadge();
    initAddToCartButtons();
  });

  // Exposed for cart.html's js/checkout.js.
  window.XNYCart = {
    PRODUCTS: PRODUCTS,
    readCart: readCart,
    writeCart: writeCart,
    addItem: addItem,
    updateQty: updateQty,
    removeItem: removeItem,
    clearCart: clearCart,
    getSubtotal: getSubtotal,
    getItemCount: getItemCount,
    updateBadge: updateBadge
  };
})(window);
