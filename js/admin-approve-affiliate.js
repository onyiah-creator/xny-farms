/* =========================================================
   XNY Farms Limited — Affiliate approval (admin-approve-affiliate.html)
   Assigns a referral code via /api/register-affiliate, then opens a
   pre-filled welcome email in the admin's own mail client.

   There is deliberately no automatic email sending: this project has no
   transactional email service or API key. The message is composed for
   you; you still press send. See README section 6.
   ========================================================= */
(function () {
  "use strict";

  var ENDPOINT = "/api/register-affiliate";
  var CODE_PATTERN = /^[A-Za-z0-9]{3,32}$/;
  var COMMISSION_LABEL = "8%";

  var els = {};
  var lastApproval = null;

  function setStatus(el, message, kind) {
    el.textContent = message || "";
    el.style.color = kind === "error" ? "#b23b2e"
      : kind === "good" ? "var(--green-700)"
      : "var(--muted)";
  }

  function post(payload) {
    return window.fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json()
        .catch(function () { return {}; })
        .then(function (data) { return { status: res.status, data: data }; });
    });
  }

  function siteOrigin() {
    // Works on the live domain and on any preview deployment.
    return window.location.origin.replace(/\/$/, "");
  }

  function referralLink(code) { return siteOrigin() + "/?ref=" + encodeURIComponent(code); }
  function statsLink(code) { return siteOrigin() + "/my-stats.html?code=" + encodeURIComponent(code); }

  function welcomeEmail(approval) {
    var subject = "Welcome to the XNY Farms Affiliate Program!";
    var body = [
      "Hi " + approval.name + ",",
      "",
      "Welcome to the XNY Farms affiliate programme — your account is approved and ready to use.",
      "",
      "Your referral code: " + approval.code,
      "",
      "Your personal referral link:",
      referralLink(approval.code),
      "",
      "Share that link anywhere — WhatsApp, Instagram, or in person. Anyone who opens it and",
      "buys from us is credited to you automatically. You can also use the Share button on any",
      "product page while your link is active, and it will include your code for you.",
      "",
      "You earn " + COMMISSION_LABEL + " commission on every completed sale made through your link,",
      "calculated on the order subtotal (before delivery).",
      "",
      "Check your earnings any time here:",
      statsLink(approval.code),
      "",
      "Commission is confirmed and paid after XNY Farms verifies each order.",
      "",
      "Thank you for partnering with us.",
      "",
      "XNY Farms Limited",
      "xnyfarms@gmail.com | +234 806 013 8299"
    ].join("\n");

    // The address is left unencoded (matching the other forms on the site —
    // some mail clients mishandle a percent-encoded "@"), but anything that
    // could break out of the mailto into extra headers is stripped first.
    var to = String(approval.email).replace(/[?&#\s]/g, "");

    return "mailto:" + to +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
  }

  function openWelcomeEmail() {
    if (!lastApproval) return;
    window.location.href = welcomeEmail(lastApproval);
  }

  function showSuccess(approval) {
    lastApproval = approval;
    els.doneName.textContent = approval.name;
    els.doneCode.textContent = approval.code;
    els.doneLink.textContent = referralLink(approval.code);
    els.doneStats.textContent = statsLink(approval.code);
    els.card.hidden = true;
    els.success.hidden = false;
    openWelcomeEmail();
  }

  function checkAvailability() {
    var code = els.code.value.trim();
    if (!CODE_PATTERN.test(code)) {
      setStatus(els.codeStatus, "Code must be 3–32 letters/digits, no spaces.", "error");
      return;
    }
    if (!els.password.value) {
      setStatus(els.codeStatus, "Enter the report password first.", "error");
      return;
    }
    setStatus(els.codeStatus, "Checking…", null);
    post({ password: els.password.value, code: code, check_only: true }).then(function (r) {
      if (r.status === 200 && r.data.ok) {
        setStatus(els.codeStatus, "✓ " + r.data.code + " is available.", "good");
      } else {
        setStatus(els.codeStatus, r.data.error || "Could not check that code.", "error");
      }
    }).catch(function (err) {
      setStatus(els.codeStatus, "Could not reach the server. (" + err + ")", "error");
    });
  }

  function submit(e) {
    e.preventDefault();
    if (!els.form.checkValidity()) {
      els.form.reportValidity();
      return;
    }
    var code = els.code.value.trim();
    if (!CODE_PATTERN.test(code)) {
      setStatus(els.status, "Code must be 3–32 letters/digits, no spaces.", "error");
      return;
    }

    els.submit.disabled = true;
    setStatus(els.status, "Approving…", null);

    // The server re-checks availability and refuses a duplicate with 409,
    // so this is safe even if the availability probe was never run.
    post({
      password: els.password.value,
      code: code,
      name: els.name.value.trim(),
      email: els.email.value.trim()
    }).then(function (r) {
      els.submit.disabled = false;
      if (r.status === 200 && r.data.ok) {
        setStatus(els.status, "", null);
        showSuccess({ code: r.data.code, name: r.data.name, email: r.data.email });
        return;
      }
      setStatus(els.status, r.data.error || "Could not approve this affiliate.", "error");
    }).catch(function (err) {
      els.submit.disabled = false;
      setStatus(els.status,
        "Could not reach the server. If you're viewing this page outside Cloudflare Pages, " +
        "the /api/ functions aren't running. (" + err + ")", "error");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    els.card = document.getElementById("approve-card");
    els.form = document.getElementById("approve-form");
    els.password = document.getElementById("ap-password");
    els.name = document.getElementById("ap-name");
    els.email = document.getElementById("ap-email");
    els.code = document.getElementById("ap-code");
    els.codeStatus = document.getElementById("ap-code-status");
    els.status = document.getElementById("ap-status");
    els.submit = document.getElementById("ap-submit");
    els.check = document.getElementById("ap-check");
    els.success = document.getElementById("approve-success");
    els.doneName = document.getElementById("ap-done-name");
    els.doneCode = document.getElementById("ap-done-code");
    els.doneLink = document.getElementById("ap-done-link");
    els.doneStats = document.getElementById("ap-done-stats");
    els.resend = document.getElementById("ap-resend");
    els.another = document.getElementById("ap-another");

    if (!els.form) return;

    els.form.addEventListener("submit", submit);
    els.check.addEventListener("click", checkAvailability);
    els.resend.addEventListener("click", openWelcomeEmail);
    els.another.addEventListener("click", function () {
      els.success.hidden = true;
      els.card.hidden = false;
      els.name.value = "";
      els.email.value = "";
      els.code.value = "";
      setStatus(els.codeStatus, "", null);
      setStatus(els.status, "", null);
      els.name.focus();
    });

    // A code that's been edited since the last check shouldn't keep
    // showing a stale "available" tick.
    els.code.addEventListener("input", function () {
      setStatus(els.codeStatus, "", null);
    });
  });
})();
