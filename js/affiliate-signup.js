/* =========================================================
   XNY Farms Limited — affiliate signup (affiliate-signup.html)
   Posts the form to /api/submit-affiliate-application and walks the person
   through the result: field errors inline, the "already registered" and
   "confirmation already sent" cases with a way forward, and the "check your
   email" screen. Nothing is opened in an email app: the old mailto step is gone.

   Cloudflare Turnstile is optional. It only appears if
   window.XNY_TURNSTILE_SITE_KEY (set in the page) is non-empty.
   ========================================================= */
(function () {
  "use strict";

  var SUBMIT = "/api/submit-affiliate-application";
  var RESEND = "/api/resend-confirmation";
  var FIELDS = ["name", "email", "phone", "bank_name", "account_number", "account_holder", "consent", "turnstile"];
  var els = {};
  var turnstileId = null;
  var turnstileToken = "";
  var lastEmail = "";

  function siteKey() { return (window.XNY_TURNSTILE_SITE_KEY || "").trim(); }

  function clearErrors() {
    FIELDS.forEach(function (f) {
      var p = document.getElementById("err-" + f);
      if (p) p.textContent = "";
    });
    Array.prototype.forEach.call(els.form.querySelectorAll("[aria-invalid]"), function (n) { n.removeAttribute("aria-invalid"); });
    hideMessage();
  }

  function fieldError(field, message) {
    var p = document.getElementById("err-" + field);
    if (p) p.textContent = message;
    var input = els.form.elements[field];
    if (input && input.setAttribute) {
      input.setAttribute("aria-invalid", "true");
      if (input.focus) input.focus();
    }
  }

  function hideMessage() { els.message.hidden = true; els.message.innerHTML = ""; els.message.className = "signup-message"; }

  function showMessage(text, kind, extraNode) {
    els.message.innerHTML = "";
    els.message.className = "signup-message signup-message--" + (kind || "error");
    var p = document.createElement("p");
    p.textContent = text;
    els.message.appendChild(p);
    if (extraNode) els.message.appendChild(extraNode);
    els.message.hidden = false;
  }

  function busy(isBusy) {
    els.submit.disabled = isBusy;
    els.submit.textContent = isBusy ? "Signing you up…" : "Sign Up";
    els.form.setAttribute("aria-busy", isBusy ? "true" : "false");
  }

  /* ---- Turnstile ---- */
  function initTurnstile() {
    var key = siteKey();
    if (!key) return;
    els.turnstileWrap.hidden = false;
    window.xnyTurnstileLoaded = function () {
      if (!window.turnstile) return;
      turnstileId = window.turnstile.render("#turnstile-box", {
        sitekey: key,
        callback: function (token) { turnstileToken = token; document.getElementById("err-turnstile").textContent = ""; },
        "expired-callback": function () { turnstileToken = ""; },
        "error-callback": function () { turnstileToken = ""; }
      });
    };
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=xnyTurnstileLoaded";
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }
  function resetTurnstile() {
    turnstileToken = "";
    if (turnstileId !== null && window.turnstile) { try { window.turnstile.reset(turnstileId); } catch (e) { /* ignore */ } }
  }

  /* ---- results ---- */
  function showDone(email) {
    els.form.hidden = true;
    document.getElementById("done-email").textContent = email;
    els.done.hidden = false;
    els.done.scrollIntoView({ block: "start", behavior: "smooth" });
    document.getElementById("done-resend").focus({ preventScroll: true });
  }

  function resend(statusEl, button) {
    button.disabled = true;
    statusEl.style.color = "var(--muted)";
    statusEl.textContent = "Sending…";
    window.fetch(RESEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: lastEmail })
    })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { status: res.status, data: d }; }); })
      .then(function (r) {
        if (r.status === 200 && r.data.ok) {
          statusEl.style.color = "var(--green-700)";
          statusEl.textContent = "Sent. Check your inbox and spam folder.";
        } else {
          statusEl.style.color = "#b23b2e";
          statusEl.textContent = r.data.error || "We couldn't send it just now. Please try again in a few minutes.";
        }
      })
      .catch(function () {
        statusEl.style.color = "#b23b2e";
        statusEl.textContent = "We couldn't reach the server. Please try again.";
      })
      .then(function () { button.disabled = false; });
  }

  function handle(r) {
    var d = r.data || {};
    if (r.status === 200 && d.ok) { showDone(lastEmail); return; }

    if (r.status === 400 && d.field) {
      var known = FIELDS.indexOf(d.field) !== -1;
      if (known) { fieldError(d.field, d.error || "Please check this field."); return; }
    }

    if (r.status === 409 && d.status === "already_registered") {
      var link = document.createElement("a");
      link.href = "#resend-welcome";
      link.className = "btn btn--outline btn--sm";
      link.textContent = "Resend my welcome email";
      link.addEventListener("click", function () {
        var rw = document.getElementById("rw-email");
        if (rw) { rw.value = lastEmail; window.setTimeout(function () { rw.focus(); }, 50); }
      });
      if (d.field === "email" || d.field === "phone") fieldError(d.field, d.error || "Already registered.");
      showMessage(d.error || "This email or phone number is already registered.", "error", link);
      return;
    }

    if (r.status === 409 && d.status === "pending_confirmation") {
      var again = document.createElement("button");
      again.type = "button";
      again.className = "btn btn--outline btn--sm";
      again.textContent = "Send the confirmation email again";
      var st = document.createElement("p");
      st.className = "form-status";
      st.setAttribute("role", "status");
      st.setAttribute("aria-live", "polite");
      var box = document.createElement("div");
      box.appendChild(again);
      box.appendChild(st);
      again.addEventListener("click", function () { resend(st, again); });
      showMessage(d.error, "info", box);
      return;
    }

    if (r.status === 429) { showMessage(d.error || "Too many attempts. Please try again in a while.", "error"); return; }
    if (r.status === 503 && d.field === "turnstile") { fieldError("turnstile", d.error); return; }
    showMessage(d.error || "Something went wrong on our side. Please try again in a few minutes, or email xnyfarms@gmail.com.", "error");
  }

  function submit(e) {
    e.preventDefault();
    clearErrors();

    // Browser validation first (messages come from the browser), then our own for the consent box.
    if (!els.form.checkValidity()) {
      var first = els.form.querySelector(":invalid");
      els.form.reportValidity();
      if (first && first.name === "consent") document.getElementById("err-consent").textContent = "Please tick the box to agree before continuing.";
      return;
    }
    if (siteKey() && !turnstileToken) {
      document.getElementById("err-turnstile").textContent = "Please complete the security check first.";
      return;
    }

    var f = els.form.elements;
    lastEmail = f.email.value.trim();
    var payload = {
      name: f.name.value,
      email: f.email.value,
      phone: f.phone.value,
      bank_name: f.bank_name.value,
      account_number: f.account_number.value,
      account_holder: f.account_holder.value,
      promotion_plan: f.promotion_plan.value,
      website: f.website.value,
      consent: f.consent.checked,
      submitted_at: new Date().toISOString()
    };
    if (siteKey()) payload.turnstile_token = turnstileToken;

    busy(true);
    window.fetch(SUBMIT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { status: res.status, data: d }; }); })
      .then(handle)
      .catch(function () {
        showMessage("We couldn't reach the server. Please check your connection and try again.", "error");
      })
      .then(function () {
        busy(false);
        resetTurnstile();      // a Turnstile token is single-use
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    els.form = document.getElementById("signup-form");
    if (!els.form) return;
    els.submit = document.getElementById("signup-submit");
    els.message = document.getElementById("signup-message");
    els.done = document.getElementById("signup-done");
    els.turnstileWrap = document.getElementById("turnstile-wrap");

    els.form.addEventListener("submit", submit);
    document.getElementById("done-resend").addEventListener("click", function () {
      resend(document.getElementById("done-status"), document.getElementById("done-resend"));
    });
    initTurnstile();
  });
})();
