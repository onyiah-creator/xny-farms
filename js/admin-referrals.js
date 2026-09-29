/* =========================================================
   XNY Farms Limited — Referral report (admin-referrals.html)
   Posts the report password to /api/get-referrals and renders the
   aggregated commission table. The password is never stored — it is
   held in memory only, so a refresh re-asks for it.
   ========================================================= */
(function () {
  "use strict";

  var ENDPOINT = "/api/get-referrals";
  var els = {};
  var sessionPassword = "";

  function money(n) {
    return "₦" + Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
  }

  function setStatus(message, isError) {
    els.status.textContent = message || "";
    els.status.style.color = isError ? "#b23b2e" : "var(--muted)";
  }

  function render(data) {
    els.rate.textContent = Math.round((data.commission_rate || 0) * 10000) / 100 + "%";
    els.generated.textContent = data.generated_at
      ? new Date(data.generated_at).toLocaleString()
      : "—";

    els.rows.innerHTML = "";
    var rows = data.rows || [];

    rows.forEach(function (row) {
      var tr = document.createElement("tr");

      var code = document.createElement("th");
      code.setAttribute("scope", "row");
      code.textContent = row.code;

      var orders = document.createElement("td");
      orders.className = "num";
      orders.textContent = String(row.orders);

      var sales = document.createElement("td");
      sales.className = "num";
      sales.textContent = money(row.total_sales_ngn);

      var commission = document.createElement("td");
      commission.className = "num commission";
      commission.textContent = money(row.commission_ngn);

      tr.appendChild(code);
      tr.appendChild(orders);
      tr.appendChild(sales);
      tr.appendChild(commission);
      els.rows.appendChild(tr);
    });

    var totals = data.totals || { orders: 0, total_sales_ngn: 0, commission_ngn: 0 };
    els.totalOrders.textContent = String(totals.orders);
    els.totalSales.textContent = money(totals.total_sales_ngn);
    els.totalCommission.textContent = money(totals.commission_ngn);

    els.empty.hidden = rows.length > 0;
    els.tableWrap.hidden = rows.length === 0;

    els.gate.hidden = true;
    els.report.hidden = false;
  }

  function load(password) {
    setStatus("Loading…", false);
    els.submit.disabled = true;

    return window.fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (result) {
        els.submit.disabled = false;
        if (result.status === 200 && result.data && result.data.ok) {
          sessionPassword = password;
          setStatus("", false);
          render(result.data);
          return;
        }
        // 401 wrong password, 503 not configured yet, 500 read failure —
        // surface the server's own message, it names the fix.
        var message = (result.data && result.data.error) || "Could not load the report.";
        setStatus(message, true);
      })
      .catch(function (err) {
        els.submit.disabled = false;
        setStatus(
          "Could not reach the report service. If you're viewing this page outside " +
          "Cloudflare Pages, the /api/ functions aren't running. (" + err + ")",
          true
        );
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    els.gate = document.getElementById("admin-gate");
    els.form = document.getElementById("admin-form");
    els.password = document.getElementById("admin-password");
    els.submit = document.getElementById("admin-submit");
    els.status = document.getElementById("admin-status");
    els.report = document.getElementById("admin-report");
    els.rows = document.getElementById("admin-rows");
    els.rate = document.getElementById("admin-rate");
    els.generated = document.getElementById("admin-generated");
    els.empty = document.getElementById("admin-empty");
    els.tableWrap = document.querySelector(".admin-table-wrap");
    els.totalOrders = document.getElementById("admin-total-orders");
    els.totalSales = document.getElementById("admin-total-sales");
    els.totalCommission = document.getElementById("admin-total-commission");
    els.refresh = document.getElementById("admin-refresh");

    if (!els.form) return;

    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!els.form.checkValidity()) {
        els.form.reportValidity();
        return;
      }
      load(els.password.value);
    });

    els.refresh.addEventListener("click", function () {
      if (sessionPassword) load(sessionPassword);
    });
  });
})();
