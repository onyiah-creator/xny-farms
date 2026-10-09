/* =========================================================
   XNY Farms Limited — "Resend my welcome email"
   Binds every form[data-resend-welcome] (affiliate-signup.html, my-stats.html).
   The server always answers the same thing whether or not the email is
   registered, and this just shows that answer: it never says "found" or
   "not found".
   ========================================================= */
(function () {
  "use strict";

  function bind(form) {
    var status = form.querySelector(".form-status");
    var button = form.querySelector('button[type="submit"]');
    var input = form.querySelector('input[name="email"]');

    function say(message, isError) {
      status.textContent = message;
      status.style.color = isError ? "#b23b2e" : "var(--green-700)";
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = input.value.trim();
      if (!email || !input.checkValidity()) {
        say("Please enter your registered email address.", true);
        input.focus();
        return;
      }
      button.disabled = true;
      var label = button.textContent;
      button.textContent = "Sending…";
      say("", false);

      window.fetch("/api/resend-welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email })
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
        })
        .then(function (r) {
          if (r.status === 200 && r.data.ok) {
            say(r.data.message || "If that email is registered, we have sent your details.", false);
          } else if (r.status === 429) {
            say("You have asked a few times already. Please try again later.", true);
          } else {
            say(r.data.error || "Something went wrong. Please try again.", true);
          }
        })
        .catch(function () {
          say("We couldn't reach the server. Please check your connection and try again.", true);
        })
        .then(function () {
          button.disabled = false;
          button.textContent = label;
        });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    Array.prototype.forEach.call(document.querySelectorAll("form[data-resend-welcome]"), bind);
  });
})();
