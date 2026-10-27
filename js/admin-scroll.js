/* =========================================================
   XNY Farms Limited — admin scroll helpers

   Two small floating buttons on the admin pages: "jump to the bottom"
   (shown while there is a lot of page left below) and "back to the top"
   (shown once you have scrolled down). The admin pages do not load
   main.js, so they do not get the storefront's jump-down button.
   Hidden when printing. On the pricing page they sit above the sticky
   save bar.
   ========================================================= */
(function () {
  "use strict";
  if (document.querySelector(".admin-jump")) return;

  var THRESHOLD = 240;   // px of page that must be left before a button appears

  function make(cls, label, path) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "admin-jump__btn " + cls;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.hidden = true;
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + path + '"/></svg>';
    return b;
  }

  var wrap = document.createElement("div");
  wrap.className = "admin-jump no-print";
  var up = make("admin-jump__up", "Back to the top", "M6 18.5l6-6 6 6M6 11.5l6-6 6 6");
  var down = make("admin-jump__down", "Jump to the bottom", "M6 5.5l6 6 6-6M6 12.5l6 6 6-6");
  wrap.appendChild(up);
  wrap.appendChild(down);
  document.body.appendChild(wrap);

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function scrollTo(y) { window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" }); }

  up.addEventListener("click", function () { scrollTo(0); });
  down.addEventListener("click", function () { scrollTo(document.documentElement.scrollHeight); });

  var queued = false;
  function update() {
    queued = false;
    var doc = document.documentElement;
    var y = window.pageYOffset || doc.scrollTop || 0;
    var remaining = doc.scrollHeight - (y + window.innerHeight);
    up.hidden = y < THRESHOLD;
    down.hidden = remaining < THRESHOLD;
    wrap.hidden = up.hidden && down.hidden;
  }
  function queue() { if (!queued) { queued = true; window.requestAnimationFrame(update); } }

  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
  if (window.ResizeObserver) new ResizeObserver(queue).observe(document.body);   // the page grows as data loads
  update();
})();
