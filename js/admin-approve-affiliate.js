/* =========================================================
   XNY Farms Limited — Affiliate approval (admin-approve-affiliate.html)
   Sign in, review pending applications, assign a referral code, and the
   welcome email is sent automatically through Resend
   (/api/send-affiliate-email). Already-approved affiliates are listed
   below, each with a "Resend Welcome Email" button.

   The old client-side mailto: draft remains as a manual fallback button
   ("Resend manually via email client") — for if Resend fails, or if you'd
   rather read the message before it goes — but it is no longer automatic.
   See README section 7 (referral / affiliate programme).
   ========================================================= */
(function () {
  "use strict";

  var REGISTER_ENDPOINT = "/api/register-affiliate";
  var PENDING_ENDPOINT = "/api/get-pending-applications";
  var AFFILIATES_ENDPOINT = "/api/get-affiliates";
  var EMAIL_ENDPOINT = "/api/send-affiliate-email";
  var STATUS_ENDPOINT = "/api/set-affiliate-status";
  var REBUILD_ENDPOINT = "/api/rebuild-index";
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
        // Independent of the pending list: if this fails the page still works.
        loadAffiliates();
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

  /* ---------- sending the welcome email (Resend) ---------- */

  /* Asks the server to email the affiliate on file for `code`. The request
     carries only the password and the code — the server looks up the
     recipient itself, so this can't be pointed at an arbitrary address. */
  function sendWelcomeEmail(code) {
    return post(EMAIL_ENDPOINT, { password: sessionPassword, code: code })
      .then(function (r) {
        if (r.status === 200 && r.data.ok) {
          return { ok: true, email: r.data.sent_to };
        }
        return { ok: false, error: r.data.error || "The email service returned an error (HTTP " + r.status + ")." };
      })
      .catch(function (err) {
        return {
          ok: false,
          error: "Could not reach the server. If you're viewing this page outside Cloudflare " +
            "Pages, the /api/ functions aren't running. (" + err + ")"
        };
      });
  }

  /* ---------- approved affiliates ---------- */

  function renderAffiliates(affiliates) {
    els.afList.innerHTML = "";
    els.afCount.textContent = String(affiliates.length);
    els.afNone.hidden = affiliates.length > 0;

    affiliates.forEach(function (aff) {
      var row = document.createElement("div");
      row.className = "aff-row";

      var info = document.createElement("div");
      info.className = "aff-row__info";

      var top = document.createElement("div");
      top.className = "aff-row__top";
      var name = document.createElement("strong");
      name.textContent = aff.name || "(no name)";
      var code = document.createElement("span");
      code.className = "aff-row__code";
      code.textContent = aff.code;
      top.appendChild(name);
      top.appendChild(code);

      var meta = document.createElement("div");
      meta.className = "aff-row__meta";
      // textContent throughout — names/emails originate from a public form.
      var suspended = aff.status === "suspended";
      if (suspended) {
        var badge = document.createElement("span");
        badge.className = "badge badge--warn";
        badge.style.margin = "0";
        badge.textContent = "suspended";
        top.appendChild(badge);
      }
      var sourceText = aff.source === "self-signup" ? "self-signup" : "added by admin";
      var confirmedText = aff.email_verified_at ? "email confirmed " + formatDate(aff.email_verified_at) : "";
      meta.textContent = (aff.email || "no email on file") +
        (aff.approved_at ? "  \u00b7  " + (aff.email_verified_at ? "activated " : "approved ") + formatDate(aff.approved_at) : "") +
        "  \u00b7  " + sourceText + (confirmedText ? "  \u00b7  " + confirmedText : "");

      info.appendChild(top);
      info.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "aff-row__actions";

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--outline";
      btn.textContent = "Resend Welcome Email";
      if (!aff.email) btn.disabled = true;

      var status = document.createElement("span");
      status.className = "aff-row__status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");

      btn.addEventListener("click", function () {
        btn.disabled = true;
        setStatus(status, "Sending\u2026", null);
        sendWelcomeEmail(aff.code).then(function (result) {
          btn.disabled = false;
          if (result.ok) {
            setStatus(status, "\u2713 Sent to " + result.email, "good");
          } else {
            setStatus(status, "Failed: " + result.error, "error");
          }
        });
      });

      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "btn btn--outline";
      toggle.textContent = suspended ? "Reactivate" : "Suspend";
      toggle.setAttribute("data-action", suspended ? "reactivate" : "suspend");
      toggle.addEventListener("click", function () {
        var next = suspended ? "active" : "suspended";
        var question = suspended
          ? "Reactivate " + (aff.name || aff.code) + " (" + aff.code + ")? Their code will earn commission again."
          : "Suspend " + (aff.name || aff.code) + " (" + aff.code + ")?\n\nTheir code stops earning commission straight away and their stats page shows 'account paused'. Their existing sales and balance are kept and stay in the referral report.";
        if (!window.confirm(question)) return;
        toggle.disabled = true;
        setStatus(status, "Updating\u2026", null);
        post(STATUS_ENDPOINT, { password: sessionPassword, code: aff.code, status: next }).then(function (r) {
          if (r.status === 200 && r.data.ok) {
            return loadAffiliates();
          }
          toggle.disabled = false;
          setStatus(status, "Failed: " + (r.data.error || "could not update"), "error");
        }).catch(function () {
          toggle.disabled = false;
          setStatus(status, "Failed: could not reach the server", "error");
        });
      });

      actions.appendChild(btn);
      actions.appendChild(toggle);
      actions.appendChild(status);
      row.appendChild(info);
      row.appendChild(actions);
      els.afList.appendChild(row);
    });
  }

  function loadAffiliates() {
    setStatus(els.afStatus, "", null);
    return post(AFFILIATES_ENDPOINT, { password: sessionPassword }).then(function (r) {
      if (r.status === 200 && r.data.ok) {
        renderAffiliates(r.data.affiliates || []);
        showConfig(r.data.config || {});
        return;
      }
      els.afNone.hidden = true;
      setStatus(els.afStatus, r.data.error || "Could not load approved affiliates.", "error");
    }).catch(function (err) {
      els.afNone.hidden = true;
      setStatus(els.afStatus, "Could not load approved affiliates. (" + err + ")", "error");
    });
  }

  /* A missing safeguard is shown, not silent: signups still work without Turnstile. */
  function showConfig(config) {
    var warnings = [];
    if (config.turnstile_secret_configured === false) {
      warnings.push("Turnstile is not configured (no TURNSTILE_SECRET_KEY): signups are protected by the honeypot and rate limits only. See the README to switch it on.");
    }
    if (config.resend_configured === false) {
      warnings.push("RESEND_API_KEY is not set: signup and welcome emails cannot be sent.");
    }
    els.configWarning.hidden = warnings.length === 0;
    els.configWarning.textContent = warnings.length ? "\u26a0 " + warnings.join("  \u26a0 ") : "";
  }

  function rebuildIndex() {
    els.idxButton.disabled = true;
    setStatus(els.idxStatus, "Rebuilding\u2026", null);
    els.idxResult.hidden = true;
    els.idxResult.innerHTML = "";
    post(REBUILD_ENDPOINT, { password: sessionPassword }).then(function (r) {
      els.idxButton.disabled = false;
      var d = r.data || {};
      if (r.status !== 200 && !d.affiliates) {
        setStatus(els.idxStatus, d.error || "Could not rebuild the index.", "error");
        return;
      }
      setStatus(els.idxStatus, r.status === 200 ? "Done." : (d.error || "Stopped part-way. Run it again."), r.status === 200 ? "good" : "error");
      var lines = [
        d.affiliates + " affiliate" + (d.affiliates === 1 ? "" : "s") + " checked.",
        d.indexed_email + " email" + (d.indexed_email === 1 ? "" : "s") + " and " + d.indexed_phone + " phone number" + (d.indexed_phone === 1 ? "" : "s") + " newly indexed.",
        d.already_indexed_email + " emails and " + d.already_indexed_phone + " phone numbers were already indexed.",
        d.no_phone + " with no phone number on file" + (d.invalid_phone ? ", " + d.invalid_phone + " with a phone number that couldn\u2019t be read" : "") + (d.no_email ? ", " + d.no_email + " with no usable email" : "") + "."
      ];
      lines.forEach(function (text) {
        var p = document.createElement("p");
        p.textContent = text;
        els.idxResult.appendChild(p);
      });
      var conflicts = d.conflicts || [];
      var head = document.createElement("p");
      head.style.fontWeight = "700";
      head.textContent = conflicts.length ? conflicts.length + " conflict" + (conflicts.length === 1 ? "" : "s") + " found (nothing was changed):" : "No conflicts: no two affiliates share an email or phone number.";
      els.idxResult.appendChild(head);
      conflicts.forEach(function (c) {
        var p = document.createElement("p");
        p.textContent = "Same " + c.field + " (" + c.value + "): " + c.codes.join(" and ") + (c.note ? " \u2014 " + c.note : "") + ". The older one keeps the index entry.";
        els.idxResult.appendChild(p);
      });
      els.idxResult.hidden = false;
    }).catch(function () {
      els.idxButton.disabled = false;
      setStatus(els.idxStatus, "Could not reach the server.", "error");
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
    sendFromSuccessPanel();
  }

  /* The primary path: email the new affiliate through Resend. The affiliate
     is already registered by this point, so a failure here must never read
     as a failed approval — the status says so explicitly and leaves the
     manual routes open. */
  function sendFromSuccessPanel() {
    if (!lastApproval) return;
    els.emailRetry.hidden = true;
    els.emailRetry.disabled = true;
    setStatus(els.emailStatus, "Sending welcome email to " + lastApproval.email + "\u2026", null);

    sendWelcomeEmail(lastApproval.code).then(function (result) {
      els.emailRetry.disabled = false;
      if (result.ok) {
        els.emailRetry.hidden = true;
        setStatus(els.emailStatus, "\u2713 Welcome email sent to " + result.email, "good");
      } else {
        els.emailRetry.hidden = false;
        setStatus(els.emailStatus,
          "Affiliate approved \u2014 but the email failed to send: " + result.error +
          " You can still share the link manually.", "error");
      }
    });
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
        if (r.data.warnings && r.data.warnings.length) {
          window.alert("Approved, but note:\n\n" + r.data.warnings.join("\n"));
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
    els.emailStatus = document.getElementById("ap-email-status");
    els.emailRetry = document.getElementById("ap-email-retry");

    els.afCount = document.getElementById("af-count");
    els.afList = document.getElementById("af-list");
    els.afNone = document.getElementById("af-none");
    els.afStatus = document.getElementById("af-status");
    els.configWarning = document.getElementById("ap-config-warning");
    els.idxButton = document.getElementById("idx-rebuild");
    els.idxStatus = document.getElementById("idx-status");
    els.idxResult = document.getElementById("idx-result");

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
    els.idxButton.addEventListener("click", function () {
      if (window.confirm("Build the duplicate-detection index for all existing affiliates?\n\nIt only adds index entries and never changes an affiliate. Safe to run again.")) rebuildIndex();
    });
    els.form.addEventListener("submit", submit);
    els.check.addEventListener("click", checkAvailability);
    els.clear.addEventListener("click", clearSelection);
    els.resend.addEventListener("click", openWelcomeEmail);
    els.emailRetry.addEventListener("click", sendFromSuccessPanel);

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
