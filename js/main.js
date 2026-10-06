/* =========================================================
   XNY Farms Limited — front-end behaviour
   - Mobile nav toggle
   - Active nav link highlighting
   - Client-side form validation + friendly submit handling
   - Floating "jump down" button for long pages
   No framework, no build step.
   ========================================================= */
(function () {
  "use strict";

  /* ---- Mobile navigation toggle ---- */
  function initNav() {
    var toggle = document.querySelector(".nav__toggle");
    var links = document.querySelector(".nav__links");
    if (!toggle || !links) return;
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      // Same class on the button drives the CSS hamburger → X animation.
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ---- Highlight the current page in the nav ---- */
  function initActiveLink() {
    var path = window.location.pathname.split("/").pop() || "index.html";
    var links = document.querySelectorAll(".nav__links a");
    links.forEach(function (a) {
      var href = (a.getAttribute("href") || "").split("/").pop();
      if (href === path) a.classList.add("is-active");
    });
  }

  /* ---- Contact / wholesale form handling ----
     No backend — these forms work entirely via mailto:. On submit we
     validate required fields, build a mailto: link from the entered
     values, and hand off to the user's email client. Nothing is sent
     over the network by this site. A visible email address is also
     shown near each form in the HTML as a fallback, in case the
     visitor's device has no configured email client.                */
  /* Fire-and-forget POST of a form's named fields, used alongside (never
     instead of) the mailto: hand-off. Returns nothing and never throws. */
  function postFormData(form, url) {
    var payload = {};
    form.querySelectorAll("input, select, textarea").forEach(function (el) {
      if (!el.name || el.type === "submit") return;
      payload[el.name] = el.value;
    });
    payload.submitted_at = new Date().toISOString();

    try {
      window.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      })
        .then(function (res) {
          if (!res.ok) console.log("[xny] form POST returned HTTP " + res.status);
        })
        .catch(function (err) {
          console.log("[xny] form POST failed:", err);
        });
    } catch (err) {
      console.log("[xny] form POST failed:", err);
    }
  }

  function initForms() {
    var forms = document.querySelectorAll("form[data-xny-form]");
    forms.forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var status = form.querySelector(".form-status");

        // Required-field check (name, email, message at minimum) —
        // let the browser surface its native validation messages.
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        var to = form.getAttribute("data-mailto") || "xnyfarms@gmail.com";
        var subject = form.getAttribute("data-subject") || "Website enquiry — XNY Farms";
        var lines = [];
        form.querySelectorAll("input, select, textarea").forEach(function (el) {
          if (!el.name || el.type === "submit") return;
          var label = el.getAttribute("data-label") || el.name;
          lines.push(label + ": " + (el.value || "—"));
        });
        // Optional: also POST the fields somewhere durable (currently the
        // affiliate signup form, so applications are recorded and not just
        // emailed). Fired BEFORE the mailto: below and never awaited —
        // keepalive lets it finish even as the mail client takes over, and
        // any failure is console-only. The mailto is the user-visible
        // outcome and must not be delayed or blocked by this.
        var postUrl = form.getAttribute("data-xny-post");
        if (postUrl) postFormData(form, postUrl);

        var body = encodeURIComponent(lines.join("\n"));
        window.location.href =
          "mailto:" + to + "?subject=" + encodeURIComponent(subject) + "&body=" + body;

        if (status) {
          status.textContent =
            "Opening your email app… If nothing happens, email us directly at " + to + ".";
          status.style.color = "var(--green-700)";
        }
      });
    });
  }

  /* ---- Floating "jump down" button ----
     A small round button, bottom-right, that pages down by roughly one
     screen per tap — so on a long page like the products list you can tap
     your way through it. It is built here rather than written into every
     page's HTML, so it exists once and appears consistently everywhere
     main.js is loaded.

     Visibility rules:
       - hidden when the page is barely scrollable (total height no more
         than 1.2x the window), since there is nothing to jump through;
       - hidden once you're within 200px of the bottom, where it has done
         its job.
     The page can change height after load (images arrive, the cart renders
     its items, the single-product view hides the rest), so visibility is
     re-evaluated on a ResizeObserver as well as on scroll and resize. */
  function initJumpDown() {
    var NEAR_BOTTOM_PX = 200;     // hide when this close to the end
    var SHORT_PAGE_RATIO = 1.2;   // hide when the page is this close to one screen
    var STEP_RATIO = 0.85;        // ~a page, minus overlap so you keep your place

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jump-down";
    btn.setAttribute("aria-label", "Scroll down the page");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M6 5.5l6 6 6-6" /><path d="M6 12.5l6 6 6-6" /></svg>';
    document.body.appendChild(btn);

    function update() {
      var doc = document.documentElement;
      var viewport = window.innerHeight;
      var total = doc.scrollHeight;
      var remaining = total - (window.pageYOffset + viewport);
      var scrollable = total > viewport * SHORT_PAGE_RATIO;
      btn.classList.toggle("is-visible", scrollable && remaining > NEAR_BOTTOM_PX);
    }

    var queued = false;
    function schedule() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () {
        queued = false;
        update();
      });
    }

    btn.addEventListener("click", function () {
      var reduced = window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({
        top: Math.round(window.innerHeight * STEP_RATIO),
        behavior: reduced ? "auto" : "smooth"
      });
    });

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("load", schedule);
    if ("ResizeObserver" in window) {
      new ResizeObserver(schedule).observe(document.body);
    }
    update();
  }

  /* ---- Footer year ---- */
  function initYear() {
    var el = document.querySelector("[data-year]");
    if (el) el.textContent = new Date().getFullYear();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initActiveLink();
    initForms();
    initJumpDown();
    initYear();
  });
})();
