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
  // The prices the shopper last SAW for the items in their cart, { id: price }. The cart itself stores
  // only { id, qty }; this is kept apart so the cart page can say "Prices were updated" when the
  // price now in force differs from what they were shown.
  var SEEN_KEY = "xny_cart_seen";

  // Display data for each product. PRICES ARE NOT HERE: they come from js/pricing.js (live from
  // /api/pricing, with last-known defaults for display only), so a price change never needs a
  // code change and an old cart can never carry an old price into checkout.
  var PRODUCTS = {
    "ashe-honey-50cl": { name: "ASHE Honey", size: "50cl", image: "assets/ashe-honey-50cl.png" },
    "ashe-honey-1l": { name: "ASHE Honey", size: "1 Litre", image: "assets/ashe-honey-1l.png" },
    "palm-oil-50cl": { name: "Palm Oil", size: "50cl", image: "assets/palm-oil-50cl.png" },
    "palm-oil-1l": { name: "Palm Oil", size: "1 Litre", image: "assets/palm-oil-1l.png" }
  };

  function priceOf(id) {
    return window.XNYPricing ? window.XNYPricing.getPrice(id) : 0;
  }

  function readJson(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* not fatal */ }
  }

  function readSeen() {
    var seen = readJson(SEEN_KEY, {});
    return seen && typeof seen === "object" && !Array.isArray(seen) ? seen : {};
  }

  /* The cart as stored: [{ id, qty }]. Carts written before this change also carried name, size and
     price on each item; the old price is moved into the "seen" record (so a price change since then
     still shows the notice) and then dropped, so a stale price can never be used again. */
  function readStored() {
    var cart = readJson(STORAGE_KEY, []);
    if (!Array.isArray(cart)) return [];
    var seen = null;
    var out = [];
    cart.forEach(function (item) {
      if (!item || typeof item.id !== "string" || !PRODUCTS[item.id]) return;
      var qty = parseInt(item.qty, 10);
      if (!(qty > 0)) return;
      if (typeof item.price === "number") {
        seen = seen || readSeen();
        if (typeof seen[item.id] !== "number") seen[item.id] = item.price;
      }
      out.push({ id: item.id, qty: qty });
    });
    if (seen) {
      writeJson(SEEN_KEY, seen);
      writeJson(STORAGE_KEY, out);
    }
    return out;
  }

  /* The cart for display and maths: each stored { id, qty } with its name, size and the price in force
     NOW (from XNYPricing). */
  function readCart() {
    return readStored().map(function (item) {
      var product = PRODUCTS[item.id];
      return { id: item.id, name: product.name, size: product.size, price: priceOf(item.id), qty: item.qty };
    });
  }

  function writeCart(cart) {
    var stored = [];
    (cart || []).forEach(function (item) {
      if (item && PRODUCTS[item.id] && item.qty > 0) stored.push({ id: item.id, qty: item.qty });
    });
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
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
    var cart = readStored();
    var existing = null;
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].id === id) { existing = cart[i]; break; }
    }
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ id: id, qty: qty });
    }
    // Remember the price they were shown for this product.
    var seen = readSeen();
    seen[id] = priceOf(id);
    writeJson(SEEN_KEY, seen);
    writeCart(cart);
  }

  function updateQty(id, qty) {
    var cart = readStored();
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
    var cart = readStored().filter(function (item) { return item.id !== id; });
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

  /* Compares the prices the shopper was last shown with the prices now in force, for the items in
     their cart, and brings the record up to date. Returns true if any item's price changed.
     Call it only once live prices have loaded, never against the display defaults. */
  function checkRepricing() {
    var seen = readSeen();
    var changed = false;
    readStored().forEach(function (item) {
      var now = priceOf(item.id);
      if (typeof seen[item.id] === "number" && seen[item.id] !== now) changed = true;
      seen[item.id] = now;
    });
    writeJson(SEEN_KEY, seen);
    return changed;
  }

  /* What goes to the server with an order: only ids and quantities. The server prices them itself. */
  function getOrderLines(cart) {
    return (cart || readStored()).map(function (item) { return { id: item.id, qty: item.qty }; });
  }

  function getItemCount(cart) {
    cart = cart || readStored();
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
    checkRepricing: checkRepricing,
    getOrderLines: getOrderLines,
    updateBadge: updateBadge
  };
})(window);
