/* =========================================================
   XNY Farms Limited — Affiliate self-check (my-stats.html)
   Reads ?code=CODE from the URL and shows that one code's totals.
   No password: the endpoint only ever returns the totals for the code
   asked for, and never anyone else's figures or any customer data.
   ========================================================= */
(function () {
  "use strict";

  var ENDPOINT = "/api/get-my-stats";
  var els = {};

  function money(n) {
    return "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
  }

  function show(which) {
    ["loading", "nocode", "results", "error", "paused"].forEach(function (name) {
      if (els[name]) els[name].hidden = name !== which;
    });
    // The "lost your code?" card is for people who don't have a working stats page.
    if (els.resend) els.resend.hidden = which !== "nocode" && which !== "error";
  }

  function showError(message) {
    els.errorMessage.textContent = message;
    show("error");
  }

  function formatDate(value) {
    var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value + "T00:00:00Z" : value);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }

  // Newest first, as the server sends them. Date, amount and reference only.
  function renderPayments(payments) {
    els.paymentsList.innerHTML = "";
    payments.forEach(function (p) {
      var li = document.createElement("li");
      li.className = "pay-history__item";
      var amount = document.createElement("strong");
      amount.textContent = money(p.amount_ngn);
      li.appendChild(amount);
      var when = document.createElement("span");
      when.textContent = " on " + formatDate(p.paid_on);
      li.appendChild(when);
      if (p.reference) {
        var ref = document.createElement("span");
        ref.className = "pay-history__ref";
        ref.textContent = "ref " + p.reference;
        li.appendChild(ref);
      }
      els.paymentsList.appendChild(li);
    });
    els.payments.hidden = payments.length === 0;
  }

  function render(data) {
    els.heading.textContent = "Stats for " + data.code;
    els.orders.textContent = String(data.orders);
    els.sales.textContent = money(data.total_sales_ngn);
    els.commission.textContent = money(data.commission_ngn);
    els.paid.textContent = money(data.paid_ngn);
    els.balance.textContent = money(data.balance_due_ngn);
    renderPayments(data.payments || []);
    els.link.textContent = window.location.origin + "/?ref=" + data.code;
    // Nothing logged yet is a normal state for a new affiliate, not an error.
    els.empty.hidden = data.orders > 0;
    show("results");
  }

  function load(code) {
    show("loading");
    window.fetch(ENDPOINT + "?code=" + encodeURIComponent(code), {
      method: "GET",
      headers: { Accept: "application/json" }
    })
      .then(function (res) {
        return res.json()
          .catch(function () { return {}; })
          .then(function (data) { return { status: res.status, data: data }; });
      })
      .then(function (result) {
        if (result.status === 200 && result.data.ok && result.data.paused) {
          show("paused");
          return;
        }
        if (result.status === 200 && result.data.ok) {
          render(result.data);
          return;
        }
        showError(result.data.error || "We couldn't load stats for that code.");
      })
      .catch(function (err) {
        showError(
          "We couldn't reach the stats service. If you're viewing this page outside " +
          "Cloudflare Pages, the /api/ functions aren't running. (" + err + ")"
        );
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    els.loading = document.getElementById("stats-loading");
    els.nocode = document.getElementById("stats-nocode");
    els.results = document.getElementById("stats-results");
    els.error = document.getElementById("stats-error");
    els.paused = document.getElementById("stats-paused");
    els.resend = document.getElementById("stats-resend");
    els.errorMessage = document.getElementById("stats-error-message");
    els.heading = document.getElementById("stats-heading");
    els.orders = document.getElementById("stat-orders");
    els.sales = document.getElementById("stat-sales");
    els.commission = document.getElementById("stat-commission");
    els.paid = document.getElementById("stat-paid");
    els.balance = document.getElementById("stat-balance");
    els.payments = document.getElementById("stats-payments");
    els.paymentsList = document.getElementById("stats-payments-list");
    els.link = document.getElementById("stats-link");
    els.empty = document.getElementById("stats-empty");
    els.form = document.getElementById("stats-form");
    els.codeInput = document.getElementById("stats-code");

    if (els.form) {
      els.form.addEventListener("submit", function (e) {
        e.preventDefault();
        var code = els.codeInput.value.trim();
        if (code) load(code);
      });
    }

    var code = "";
    try {
      code = (new window.URLSearchParams(window.location.search).get("code") || "").trim();
    } catch (e) {
      code = "";
    }

    if (!code) {
      show("nocode");
      return;
    }
    load(code);
  });
})();
