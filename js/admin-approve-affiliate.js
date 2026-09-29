/* =========================================================
   XNY Farms Limited — Affiliate approval (admin-approve-affiliate.html)
   Sign in, review pending applications, assign a referral code, then
   open a pre-filled welcome email in the admin's own mail client.

   There is deliberately no automatic email sending: this project has no
   transactional email service or API key. The message is composed for
   you; you still press send. See README section 6.
   ========================================================= */
(function () {
  "use strict";

  var REGISTER_ENDPOINT = "/api/register-affiliate";
  var PENDING_ENDPOINT = "/api/get-pending-applications";
  var CODE_PATTERN = /^[A-Za-z0-9]{3,32}$/;
  var COMMISSION_LABEL = "8%";

  var els = {};
  var sessionPassword = "";     // held in memory only; a refresh re-asks
  var selectedApplication = null;
  var lastApproval = null;

  function setStatus(el, message, kind) {
    if (!el) return;
    el.textContent = message || "";
    el.style.color = kind === "error" ? "#b23b2e"
      : kind === "good" ? "var(--green-700)"
      : "var(--muted)";
  }

  function post(url, payload) {
    return window.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json()
        .catch(function () { return {}; })
        .then(function (data) { return { status: res.status, data: data }; });
    });
  }

  function siteOrigin() { return window.location.origin.replace(/\/$/, ""); }
  function referralLink(code) { return siteOrigin() + "/?ref=" + encodeURIComponent(code); }
  function statsLink(code) { return siteOrigin() + "/my-stats.html?code=" + encodeURIComponent(code); }

  function formatDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }

  /* ---------- pending applications ---------- */

  function renderApplications(applications) {
    els.list.innerHTML = "";
    els.count.textContent = String(applications.length);
    els.none.hidden = applications.length > 0;

    applications.forEach(function (app) {
      var card = document.createElement("div");
      card.className = "app-card";

      var head = document.createElement("div");
      head.className = "app-card__head";

      var title = document.createElement("h3");
      title.textContent = app.name || "(no name given)";

      var when = document.createElement("span");
      when.className = "app-card__when";
      when.textContent = formatDate(app.submitted_at);

      head.appendChild(title);
      head.appendChild(when);

      var grid = document.createElement("dl");
      grid.className = "app-card__grid";
      [
        ["Email", app.email],
        ["Phone", app.phone],
        ["Bank", app.bank_name],
        ["Account number", app.account_number],
        ["Account holder", app.account_holder],
        ["Promotion plan", app.promotion_plan]
      ].forEach(function (pair) {
        if (!pair[1]) return;
        var dt = document.createElement("dt");
        dt.textContent = pair[0];
        var dd = document.createElement("dd");
        // textContent throughout: applicant-supplied text is never
        // interpreted as markup.
        dd.textContent = pair[1];
        grid.appendChild(dt);
        grid.appendChild(dd);
      });

      var use = document.createElement("button");
      use.type = "button";
      use.className = "btn btn--outline";
      use.textContent = "Use This Application";
      use.addEventListener("click", function () { selectApplication(app); });

      card.appendChild(head);
      card.appendChild(grid);
      card.appendChild(use);
      els.list.appendChild(card);
    });
  }

  function loadApplications() {
    setStatus(els.gateStatus, "Loading…", null);
    return post(PENDING_ENDPOINT, { password: sessionPassword }).then(function (r) {
      if (r.status === 200 && r.data.ok) {
        setStatus(els.gateStatus, "", null);
        renderApplications(r.data.applications || []);
        els.gate.hidden = true;
        els.main.hidden = false;
        return true;
      }
      setStatus(els.gateStatus, r.data.error || "Could not load applications.", "error");
      return false;
    }).catch(function (err) {
      setStatus(els.gateStatus,
        "Could not reach the server. If you're viewing this page outside Cloudflare Pages, " +
        "the /api/ functions aren't running. (" + err + ")", "error");
      return false;
    });
  }

  function selectApplication(app) {
    selectedApplication = app;
    els.name.value = app.name || "";
    els.email.value = app.email || "";
    // The code is deliberately left blank — which code to give is the
    // admin's decision, not something to guess from the application.
    els.code.value = "";
    els.linked.hidden = false;
    els.linked.textContent = "Assigning to application from " + (app.name || "this applicant") +
      " (" + (app.email || "no email") + "). It will be marked approved once a code is assigned.";
    els.clear.hidden = false;
    setStatus(els.codeStatus, "", null);
    setStatus(els.status, "", null);
    els.code.focus();
    els.card.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearSelection() {
    selectedApplication = null;
    els.linked.hidden = true;
    els.linked.textContent = "";
    els.clear.hidden = true;
    els.name.value = "";
    els.email.value = "";
    els.code.value = "";
    setStatus(els.codeStatus, "", null);
    setStatus(els.status, "", null);
  }

  /* ---------- welcome email ---------- */

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
    els.main.hidden = true;
    els.success.hidden = false;
    openWelcomeEmail();
  }

  /* ---------- assignment ---------- */

  function checkAvailability() {
    var code = els.code.value.trim();
    if (!CODE_PATTERN.test(code)) {
      setStatus(els.codeStatus, "Code must be 3–32 letters/digits, no spaces.", "error");
      return;
    }
    setStatus(els.codeStatus, "Checking…", null);
    post(REGISTER_ENDPOINT, { password: sessionPassword, code: code, check_only: true })
      .then(function (r) {
        if (r.status === 200 && r.data.ok) {
          setStatus(els.codeStatus, "✓ " + r.data.code + " is available.", "good");
        } else {
          setStatus(els.codeStatus, r.data.error || "Could not check that code.", "error");
        }
      })
      .catch(function (err) {
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

    var payload = {
      password: sessionPassword,
      code: code,
      name: els.name.value.trim(),
      email: els.email.value.trim()
    };
    // Sending the application key lets the server mark that application
    // approved, so it drops off this list and can't be approved twice.
    if (selectedApplication && selectedApplication.key) {
      payload.application_key = selectedApplication.key;
    }

    // The server re-checks availability and refuses a duplicate with 409,
    // so this is safe even if the availability probe was never run.
    post(REGISTER_ENDPOINT, payload).then(function (r) {
      els.submit.disabled = false;
      if (r.status === 200 && r.data.ok) {
        setStatus(els.status, "", null);
        if (selectedApplication && r.data.application_updated === false) {
          console.log("[xny] affiliate saved, but the application record wasn't updated");
        }
        selectedApplication = null;
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
    els.gate = document.getElementById("approve-gate");
    els.gateForm = document.getElementById("gate-form");
    els.password = document.getElementById("ap-password");
    els.signin = document.getElementById("ap-signin");
    els.gateStatus = document.getElementById("ap-gate-status");

    els.main = document.getElementById("approve-main");
    els.count = document.getElementById("ap-count");
    els.list = document.getElementById("ap-list");
    els.none = document.getElementById("ap-none");
    els.refresh = document.getElementById("ap-refresh");

    els.card = document.getElementById("approve-card");
    els.form = document.getElementById("approve-form");
    els.name = document.getElementById("ap-name");
    els.email = document.getElementById("ap-email");
    els.code = document.getElementById("ap-code");
    els.codeStatus = document.getElementById("ap-code-status");
    els.linked = document.getElementById("ap-linked");
    els.status = document.getElementById("ap-status");
    els.submit = document.getElementById("ap-submit");
    els.check = document.getElementById("ap-check");
    els.clear = document.getElementById("ap-clear");

    els.success = document.getElementById("approve-success");
    els.doneName = document.getElementById("ap-done-name");
    els.doneCode = document.getElementById("ap-done-code");
    els.doneLink = document.getElementById("ap-done-link");
    els.doneStats = document.getElementById("ap-done-stats");
    els.resend = document.getElementById("ap-resend");
    els.another = document.getElementById("ap-another");

    if (!els.gateForm || !els.form) return;

    els.gateForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!els.gateForm.checkValidity()) {
        els.gateForm.reportValidity();
        return;
      }
      els.signin.disabled = true;
      sessionPassword = els.password.value;
      loadApplications().then(function () { els.signin.disabled = false; });
    });

    els.refresh.addEventListener("click", function () { loadApplications(); });
    els.form.addEventListener("submit", submit);
    els.check.addEventListener("click", checkAvailability);
    els.clear.addEventListener("click", clearSelection);
    els.resend.addEventListener("click", openWelcomeEmail);

    els.another.addEventListener("click", function () {
      els.success.hidden = true;
      els.main.hidden = false;
      clearSelection();
      // The one just approved should no longer be pending.
      loadApplications();
      els.name.focus();
    });

    // A code edited since the last check shouldn't keep showing a stale tick.
    els.code.addEventListener("input", function () { setStatus(els.codeStatus, "", null); });
  });
})();
