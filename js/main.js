/* =========================================================
   XNY Farms Limited — front-end behaviour
   - Mobile nav toggle
   - Active nav link highlighting
   - Client-side form validation + friendly submit handling
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
     No backend is wired up yet. Forms carry a data-form-endpoint
     attribute. When that endpoint is a real Formspree (or similar)
     URL the form posts normally. Until then we fall back to a
     mailto: draft so nothing is silently lost, and show a status
     message. Swap the endpoint in the HTML when ready.            */
  function initForms() {
    var forms = document.querySelectorAll("form[data-xny-form]");
    forms.forEach(function (form) {
      form.addEventListener("submit", function (e) {
        var status = form.querySelector(".form-status");
        var endpoint = form.getAttribute("data-form-endpoint") || "";

        // Basic required-field check (native validity as backup)
        if (!form.checkValidity()) {
          return; // let the browser surface the messages
        }

        // If a real endpoint is configured, let it POST normally.
        if (endpoint && endpoint.indexOf("REPLACE") === -1 && endpoint.charAt(0) !== "#") {
          if (status) {
            status.textContent = "Sending your message…";
            status.style.color = "var(--muted)";
          }
          return; // native submit proceeds to the endpoint
        }

        // ---- Fallback: build a mailto: draft ----
        e.preventDefault();
        var to = form.getAttribute("data-mailto") || "REPLACE_WITH_EMAIL@example.com";
        var subject = form.getAttribute("data-subject") || "Website enquiry — XNY Farms";
        var lines = [];
        form.querySelectorAll("input, select, textarea").forEach(function (el) {
          if (!el.name || el.type === "submit") return;
          var label = el.getAttribute("data-label") || el.name;
          lines.push(label + ": " + (el.value || "—"));
        });
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

  /* ---- Footer year ---- */
  function initYear() {
    var el = document.querySelector("[data-year]");
    if (el) el.textContent = new Date().getFullYear();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initActiveLink();
    initForms();
    initYear();
  });
})();
