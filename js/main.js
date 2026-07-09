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
     No backend — these forms work entirely via mailto:. On submit we
     validate required fields, build a mailto: link from the entered
     values, and hand off to the user's email client. Nothing is sent
     over the network by this site. A visible email address is also
     shown near each form in the HTML as a fallback, in case the
     visitor's device has no configured email client.                */
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
