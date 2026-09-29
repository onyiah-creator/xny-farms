/* =========================================================
   XNY Farms Limited — Product share buttons
   Builds a shareable link for a single product and hands it to the
   device's native share sheet where available, falling back to a small
   menu of direct share links on desktop.

   If the visitor has a referral code stored (js/referral.js, key
   "xny_ref_code"), it is appended as ?ref=CODE — so an affiliate sharing
   a product automatically shares their own tracked link. A visitor with
   no referral relationship shares the plain product URL.
   ========================================================= */
(function (window, document) {
  "use strict";

  var PRODUCT_PAGE = "products.html";
  var openMenu = null;

  function getRefCode() {
    // js/referral.js owns the storage key and its validation; only read
    // it directly if that module isn't on the page for some reason.
    if (window.XNYReferral && typeof window.XNYReferral.getRefCode === "function") {
      return window.XNYReferral.getRefCode();
    }
    try {
      return window.localStorage.getItem("xny_ref_code") || "";
    } catch (e) {
      return "";
    }
  }

  function productTitle(id, btn) {
    var explicit = btn.getAttribute("data-share-title");
    if (explicit) return explicit;
    var catalogue = window.XNYCart && window.XNYCart.PRODUCTS;
    var product = catalogue && catalogue[id];
    if (product) return product.name + " — " + product.size;
    return "XNY Farms";
  }

  /* Absolute URL for one product, e.g.
       https://xnyfarms.com/products.html?ref=ADEBAYO01#ashe-honey-50cl
     The query string must come BEFORE the hash, or the browser treats
     "?ref=..." as part of the fragment and the referral is never read. */
  function buildShareUrl(id) {
    var base = new URL(PRODUCT_PAGE, window.location.href);
    var code = getRefCode();
    if (code) base.searchParams.set("ref", code);
    base.hash = id;
    return base.href;
  }

  function closeMenu() {
    if (!openMenu) return;
    openMenu.menu.hidden = true;
    openMenu.btn.setAttribute("aria-expanded", "false");
    openMenu = null;
  }

  function copyLink(url, feedbackEl) {
    function done(ok) {
      if (!feedbackEl) return;
      feedbackEl.textContent = ok ? "Link copied" : "Press Ctrl/Cmd+C to copy";
      window.setTimeout(function () { feedbackEl.textContent = ""; }, 2000);
    }
    if (window.navigator.clipboard && window.navigator.clipboard.writeText) {
      window.navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
      return;
    }
    // Older browsers / insecure contexts.
    try {
      var temp = document.createElement("textarea");
      temp.value = url;
      temp.setAttribute("readonly", "");
      temp.style.position = "absolute";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(temp);
      done(ok);
    } catch (e) {
      done(false);
    }
  }

  function buildMenu(wrap, btn, id) {
    var menu = document.createElement("div");
    menu.className = "share__menu";
    menu.hidden = true;

    var feedback = document.createElement("p");
    feedback.className = "share__feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");

    // Built fresh on each open so the URL always reflects the referral
    // code as it stands right now.
    function render() {
      var url = buildShareUrl(id);
      var title = productTitle(id, btn);
      var encodedUrl = encodeURIComponent(url);
      var encodedText = encodeURIComponent(title + " — XNY Farms");

      var targets = [
        { label: "WhatsApp", href: "https://wa.me/?text=" + encodeURIComponent(title + " — XNY Farms " + url) },
        { label: "Facebook", href: "https://www.facebook.com/sharer/sharer.php?u=" + encodedUrl },
        { label: "X / Twitter", href: "https://twitter.com/intent/tweet?text=" + encodedText + "&url=" + encodedUrl }
      ];

      menu.innerHTML = "";
      targets.forEach(function (target) {
        var a = document.createElement("a");
        a.className = "share__item";
        a.href = target.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = target.label;
        a.addEventListener("click", closeMenu);
        menu.appendChild(a);
      });

      var copy = document.createElement("button");
      copy.type = "button";
      copy.className = "share__item share__item--copy";
      copy.textContent = "Copy Link";
      copy.addEventListener("click", function () { copyLink(url, feedback); });
      menu.appendChild(copy);
      menu.appendChild(feedback);
    }

    wrap.appendChild(menu);
    return { menu: menu, render: render };
  }

  function initButton(btn) {
    var id = btn.getAttribute("data-share-product");
    if (!id) return;

    var wrap = document.createElement("span");
    wrap.className = "share";
    btn.parentNode.insertBefore(wrap, btn);
    wrap.appendChild(btn);

    var built = buildMenu(wrap, btn, id);

    btn.addEventListener("click", function () {
      var url = buildShareUrl(id);
      var title = productTitle(id, btn);

      // Native share sheet (mostly mobile). Gives the user whatever they
      // actually have installed, so there's no list for us to maintain.
      if (window.navigator.share) {
        window.navigator
          .share({ title: title, text: title + " — XNY Farms", url: url })
          .catch(function () { /* user dismissed the sheet — nothing to do */ });
        return;
      }

      // Desktop fallback.
      var isOpen = openMenu && openMenu.menu === built.menu;
      closeMenu();
      if (isOpen) return;
      built.render();
      built.menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      openMenu = { menu: built.menu, btn: btn };
    });
  }

  document.addEventListener("click", function (e) {
    if (openMenu && !openMenu.menu.parentNode.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenu();
  });

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-share-product]").forEach(initButton);
  });
})(window, document);
