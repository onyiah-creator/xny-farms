/* =========================================================
   XNY Farms Limited — Referral & payout report (admin-referrals.html)

   Posts the report password to /api/get-referrals and renders, per
   affiliate and in total, what was earned, what was paid and what is still
   owed. Each row expands to show contact and payout details, the orders,
   the payment history and a "Record payment" form (/api/record-payout).

   The password is held in memory only, so a refresh re-asks for it.

   Bank details are personal data (NDPR). They are masked on screen until
   "Reveal" is pressed, never written to the console, never put in a URL,
   and never stored in the DOM while masked (the full number lives only in
   the in-memory row object). "Copy" and the CSV export use that object.
   ========================================================= */
(function () {
  "use strict";

  var REPORT = "/api/get-referrals";
  var PAYOUT = "/api/record-payout";
  var COLS = 7;

  var els = {};
  var state = {
    password: "",
    data: null,                 // last listing response
    expanded: {},               // code -> true
    revealed: {},               // code -> true (account number shown in full)
    details: {},                // code -> { status: "loading"|"ok"|"error", data, error }
    drafts: {},                 // code -> { amount, date, reference, note } typed but not yet submitted
    busy: {}                    // code -> true while a payout request is in flight
  };

  /* ---------- helpers ---------- */

  function money(n) {
    return "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function todayLocal() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function shortDate(iso) {
    if (!iso) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  /** ******4821 — everything but the last four characters. */
  function mask(number) {
    var n = String(number || "");
    if (!n) return "—";
    if (n.length <= 4) return new Array(n.length + 1).join("*");
    return new Array(n.length - 3).join("*") + n.slice(-4);
  }

  function setNotice(message, isError) {
    els.notice.textContent = message || "";
    els.notice.style.color = isError ? "#b23b2e" : "var(--green-700)";
  }

  function setStatus(message, isError) {
    els.status.textContent = message || "";
    els.status.style.color = isError ? "#b23b2e" : "var(--muted)";
  }

  function post(url, payload) {
    payload.password = state.password;
    return window.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data };
      });
    });
  }

  function findRow(code) {
    var rows = (state.data && state.data.rows) || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].code === code) return rows[i];
    return null;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("copy failed"));
    });
  }

  /* ---------- filtering ---------- */

  function visibleRows() {
    var rows = ((state.data && state.data.rows) || []).slice();
    var q = els.search.value.trim().toLowerCase();
    var dueOnly = els.filterDue.checked;
    var hideZero = els.hideZero.checked;
    rows = rows.filter(function (r) {
      if (dueOnly && !(r.balance_due_ngn > 0)) return false;
      if (hideZero && r.orders === 0) return false;
      if (q) {
        var hay = (r.name + " " + r.code + " " + r.email).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    rows.sort(function (a, b) {
      return (b.balance_due_ngn - a.balance_due_ngn) ||
             (b.commission_earned_ngn - a.commission_earned_ngn) ||
             (a.code < b.code ? -1 : 1);
    });
    return rows;
  }

  /* ---------- rendering: summary + table ---------- */

  function renderSummary() {
    var t = state.data.totals;
    els.sumSales.textContent = money(t.total_sales_ngn);
    els.sumEarned.textContent = money(t.commission_earned_ngn);
    els.sumPaid.textContent = money(t.paid_ngn);
    els.sumBalance.textContent = money(t.balance_due_ngn);
    els.sumActive.textContent = String(t.active_affiliates);
    els.sumRegistered.textContent = "of " + t.affiliates + " approved" +
      (t.unregistered_codes ? " (+" + t.unregistered_codes + " unregistered code" + (t.unregistered_codes > 1 ? "s" : "") + ")" : "");
    els.sumOrders.textContent = String(t.orders);
    if (t.overpaid_ngn > 0) {
      els.sumOverpaid.hidden = false;
      els.sumOverpaid.textContent = "plus " + money(t.overpaid_ngn) + " overpaid to some affiliates";
    } else {
      els.sumOverpaid.hidden = true;
    }
  }

  function cell(row, label, text, className) {
    var td = el("td", className || "", text);
    td.setAttribute("data-label", label);
    return td;
  }

  function renderTable() {
    var rows = visibleRows();
    els.rows.innerHTML = "";

    var sum = { orders: 0, sales: 0, earned: 0, paid: 0, balance: 0 };

    rows.forEach(function (row) {
      sum.orders += row.orders;
      sum.sales += row.total_sales_ngn;
      sum.earned += row.commission_earned_ngn;
      sum.paid += row.paid_ngn;
      sum.balance += row.balance_due_ngn;

      var open = !!state.expanded[row.code];
      var tr = el("tr", "pr-row" + (open ? " is-open" : ""));

      var th = el("th", "aff-cell");
      th.setAttribute("scope", "row");
      var toggle = el("button", "aff-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-controls", "aff-detail-" + row.code);
      toggle.setAttribute("data-code", row.code);
      toggle.appendChild(el("span", "aff-toggle__chev", "▸"));
      var who = el("span", "aff-toggle__who");
      who.appendChild(el("span", "aff-toggle__name", row.name || "(no name on file)"));
      who.appendChild(el("span", "aff-toggle__code", row.code));
      toggle.appendChild(who);
      th.appendChild(toggle);
      if (row.unregistered) th.appendChild(el("span", "badge badge--warn", "unregistered"));
      if (row.overpaid) th.appendChild(el("span", "badge badge--info", "overpaid " + money(row.overpaid_ngn)));
      tr.appendChild(th);

      tr.appendChild(cell(row, "Orders", String(row.orders), "num"));
      tr.appendChild(cell(row, "Sales", money(row.total_sales_ngn), "num"));
      tr.appendChild(cell(row, "Earned", money(row.commission_earned_ngn), "num"));
      tr.appendChild(cell(row, "Paid", money(row.paid_ngn), "num"));
      tr.appendChild(cell(row, "Balance due", money(row.balance_due_ngn), "num commission" + (row.balance_due_ngn > 0 ? " is-due" : "")));
      tr.appendChild(cell(row, "Last order", shortDate(row.last_order_at)));
      els.rows.appendChild(tr);

      if (open) els.rows.appendChild(buildDetailRow(row));
    });

    els.totalOrders.textContent = String(sum.orders);
    els.totalSales.textContent = money(sum.sales);
    els.totalEarned.textContent = money(sum.earned);
    els.totalPaid.textContent = money(sum.paid);
    els.totalBalance.textContent = money(sum.balance);
    var all = (state.data.rows || []).length;
    els.footLabel.textContent = rows.length === all ? "All affiliates (" + all + ")" : "Shown (" + rows.length + " of " + all + ")";

    els.empty.hidden = rows.length > 0;
    els.tableWrap.hidden = rows.length === 0;
    els.export.textContent = "Export CSV (" + rows.length + " row" + (rows.length === 1 ? "" : "s") + ")";
  }

  function renderAll() {
    renderSummary();
    renderTable();
  }

  /* ---------- rendering: the expanded panel ---------- */

  function dlRow(dl, label, valueNode) {
    dl.appendChild(el("dt", "", label));
    var dd = el("dd");
    dd.appendChild(valueNode);
    dl.appendChild(dd);
  }

  function textNode(text) { return document.createTextNode(text || "—"); }

  function buildContact(row) {
    var box = el("div", "aff-panel__block");
    box.appendChild(el("h3", "", "Contact"));
    var dl = el("dl", "app-card__grid");
    if (row.unregistered) {
      box.appendChild(el("p", "form-note", "This code has orders or payments but no affiliate record, so no contact details are on file."));
      return box;
    }
    if (row.email) {
      var a = el("a", "", row.email);
      a.href = "mailto:" + row.email;
      dlRow(dl, "Email", a);
    } else {
      dlRow(dl, "Email", textNode(""));
    }
    dlRow(dl, "Phone", textNode(row.phone));
    dlRow(dl, "Approved", textNode(row.approved_at ? shortDate(row.approved_at) : ""));
    box.appendChild(dl);
    return box;
  }

  function buildPayoutBlock(row) {
    var box = el("div", "aff-panel__block");
    box.appendChild(el("h3", "", "Where to send the money"));
    if (!row.payout) {
      box.appendChild(el("p", "form-note", "No payout details on file."));
      return box;
    }
    var dl = el("dl", "app-card__grid");
    dlRow(dl, "Bank", textNode(row.payout.bank_name));
    dlRow(dl, "Account holder", textNode(row.payout.account_holder));

    var acct = el("span", "acct");
    var shown = !!state.revealed[row.code];
    var number = el("span", "acct__number", shown ? row.payout.account_number || "—" : mask(row.payout.account_number));
    number.setAttribute("data-acct", "");
    acct.appendChild(number);

    if (row.payout.account_number) {
      var reveal = el("button", "btn btn--outline btn--sm no-print", shown ? "Hide" : "Reveal");
      reveal.type = "button";
      reveal.setAttribute("data-action", "reveal");
      reveal.setAttribute("data-code", row.code);
      reveal.setAttribute("aria-pressed", shown ? "true" : "false");
      acct.appendChild(reveal);

      var copy = el("button", "btn btn--outline btn--sm no-print", "Copy account number");
      copy.type = "button";
      copy.setAttribute("data-action", "copy");
      copy.setAttribute("data-code", row.code);
      acct.appendChild(copy);
    }
    dlRow(dl, "Account number", acct);
    box.appendChild(dl);
    return box;
  }

  function buildOrders(detail) {
    var box = el("div", "aff-panel__block");
    box.appendChild(el("h3", "", "Orders"));
    if (detail.status === "loading") { box.appendChild(el("p", "form-note", "Loading…")); return box; }
    if (detail.status === "error") { box.appendChild(el("p", "form-note", detail.error)); return box; }
    var list = detail.data.orders_detail;
    if (!list.length) { box.appendChild(el("p", "form-note", "No orders logged for this code yet.")); return box; }
    var wrap = el("div", "admin-table-wrap");
    var table = el("table", "admin-table admin-table--mini");
    var thead = el("thead");
    var hr = el("tr");
    ["Date", "Order ref", "Order subtotal", "Commission"].forEach(function (h, i) {
      var th = el("th", i > 1 ? "num" : "", h);
      th.setAttribute("scope", "col");
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");
    list.forEach(function (o) {
      var tr = el("tr");
      tr.appendChild(cell(null, "Date", shortDate(o.timestamp)));
      tr.appendChild(cell(null, "Order ref", o.tx_ref));
      tr.appendChild(cell(null, "Order subtotal", money(o.order_total_ngn), "num"));
      tr.appendChild(cell(null, "Commission", money(o.commission_ngn), "num"));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
    return box;
  }

  function buildPayouts(row, detail) {
    var box = el("div", "aff-panel__block");
    box.appendChild(el("h3", "", "Payments made"));
    if (detail.status === "loading") { box.appendChild(el("p", "form-note", "Loading…")); return box; }
    if (detail.status === "error") { box.appendChild(el("p", "form-note", detail.error)); return box; }
    var list = detail.data.payouts_detail;
    if (!list.length) { box.appendChild(el("p", "form-note", "No payments recorded yet.")); return box; }
    var contact = detail.data.contact || {};
    var ul = el("ul", "payout-list");
    list.forEach(function (p) {
      var what = money(p.amount_ngn) + " payment of " + shortDate(p.paid_on);
      var li = el("li", "payout-list__item");
      var main = el("div", "payout-list__main");
      main.appendChild(el("strong", "", money(p.amount_ngn)));
      main.appendChild(el("span", "", " on " + shortDate(p.paid_on)));
      if (p.reference) main.appendChild(el("span", "payout-list__ref", "ref " + p.reference));
      var st = emailStatus(p);
      var badge = el("span", "badge badge--" + st.kind + " payout-list__badge", st.text);
      if (st.title) badge.title = st.title;
      main.appendChild(badge);
      li.appendChild(main);
      if (p.note) li.appendChild(el("div", "payout-list__note", p.note));

      var actions = el("div", "payout-list__actions no-print");
      function action(label, name, extra) {
        var b = el("button", "btn btn--outline btn--sm", label);
        b.type = "button";
        b.setAttribute("data-action", name);
        b.setAttribute("data-code", row.code);
        b.setAttribute("data-key", p.key);
        b.setAttribute("aria-label", label + ": the " + what);
        if (extra) extra(b);
        actions.appendChild(b);
        return b;
      }
      action(st.kind === "ok" ? "Resend receipt" : "Send receipt", "resend-receipt", function (b) {
        b.disabled = !!state.busy["receipt:" + p.key] || contact.has_email === false;
        if (contact.has_email === false) b.title = "No email address on file";
      });

      // WhatsApp / SMS: manual, free, no API. The message is built server-side.
      var number = contact.phone_international;
      if (number && p.message) {
        var wa = el("a", "btn btn--outline btn--sm", "WhatsApp");
        wa.href = "https://wa.me/" + number + "?text=" + encodeURIComponent(p.message);
        wa.target = "_blank";
        wa.rel = "noopener noreferrer";
        wa.setAttribute("aria-label", "WhatsApp: the " + what);
        actions.appendChild(wa);
        var sms = el("a", "btn btn--outline btn--sm", "SMS");
        sms.href = "sms:+" + number + "?&body=" + encodeURIComponent(p.message);
        sms.setAttribute("aria-label", "SMS: the " + what);
        actions.appendChild(sms);
      } else {
        ["WhatsApp", "SMS"].forEach(function (label) {
          var off = el("button", "btn btn--outline btn--sm", label);
          off.type = "button";
          off.disabled = true;
          off.title = "No valid phone number on file";
          actions.appendChild(off);
        });
      }
      action("Remove", "remove-payout", function (b) { b.setAttribute("aria-label", "Remove the " + what); });
      li.appendChild(actions);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    box.appendChild(el("p", "form-note",
      "WhatsApp and SMS open a ready-written message to send yourself. SMS works on a phone; most desktop " +
      "computers have no app to open it."));
    return box;
  }

  /** How the receipt email for a payment went. notified_email is { at, ok, error } or null. */
  function emailStatus(p) {
    var n = p.notified_email;
    if (!n) return { kind: "muted", text: "Not emailed" };
    if (n.ok) return { kind: "ok", text: "Emailed " + shortDate(n.at) };
    return { kind: "warn", text: "Email failed", title: n.error || "" };
  }

  function buildForm(row, detail) {
    var box = el("div", "aff-panel__block no-print");
    box.appendChild(el("h3", "", "Record payment"));
    box.appendChild(el("p", "form-note",
      "Record a payment only after you have sent the money. Reconcile the orders against the " +
      "Flutterwave dashboard first: the order records are written by customers' browsers and are not verified."));

    var form = el("form", "payout-form");
    form.setAttribute("data-code", row.code);
    form.noValidate = false;

    var draft = state.drafts[row.code];
    var balance = detail && detail.status === "ok" ? detail.data.summary.balance_due_ngn : row.balance_due_ngn;
    var defaults = draft || { amount: balance > 0 ? String(balance) : "", date: todayLocal(), reference: "", note: "", email: true };

    function field(id, label, input) {
      var f = el("div", "field");
      var l = el("label", "", label);
      input.id = id + "-" + row.code;
      l.setAttribute("for", input.id);
      input.setAttribute("data-draft", id);
      f.appendChild(l);
      f.appendChild(input);
      return f;
    }

    var amount = el("input");
    amount.type = "number"; amount.name = "amount"; amount.required = true;
    amount.min = "0.01"; amount.step = "0.01"; amount.inputMode = "decimal";
    amount.value = defaults.amount;
    var date = el("input");
    date.type = "date"; date.name = "date"; date.required = true;
    date.max = todayLocal(); date.value = defaults.date;
    var ref = el("input");
    ref.type = "text"; ref.name = "reference"; ref.maxLength = 80; ref.autocomplete = "off";
    ref.placeholder = "e.g. Flutterwave or bank transfer reference"; ref.value = defaults.reference;
    var note = el("input");
    note.type = "text"; note.name = "note"; note.maxLength = 300; note.autocomplete = "off";
    note.value = defaults.note;

    var grid = el("div", "payout-form__grid");
    grid.appendChild(field("amount", "Amount paid (₦) *", amount));
    grid.appendChild(field("date", "Date paid *", date));
    grid.appendChild(field("reference", "Reference (optional)", ref));
    grid.appendChild(field("note", "Note (optional)", note));
    form.appendChild(grid);

    // Emails the affiliate a receipt (to the address on file; the browser never supplies one).
    var receipt = el("label", "payout-form__check");
    var receiptBox = el("input");
    receiptBox.type = "checkbox"; receiptBox.name = "email_receipt";
    receiptBox.checked = row.email ? defaults.email !== false : false;
    receiptBox.disabled = !row.email;
    receipt.appendChild(receiptBox);
    receipt.appendChild(el("span", "", row.email
      ? "Email a payment receipt to the affiliate"
      : "Email a payment receipt (no email address on file)"));
    form.appendChild(receipt);

    var submit = el("button", "btn btn--green", "Record payment");
    submit.type = "submit";
    submit.disabled = !!state.busy[row.code];
    var holder = el("div", "payout-form__actions");
    holder.appendChild(submit);
    form.appendChild(holder);
    box.appendChild(form);
    return box;
  }

  function buildDetailRow(row) {
    var tr = el("tr", "aff-detail");
    tr.id = "aff-detail-" + row.code;
    var td = el("td");
    td.colSpan = COLS;
    var panel = el("div", "aff-panel");
    var detail = state.details[row.code] || { status: "loading" };

    var top = el("div", "aff-panel__top");
    top.appendChild(buildContact(row));
    top.appendChild(buildPayoutBlock(row));
    panel.appendChild(top);
    panel.appendChild(buildForm(row, detail));
    panel.appendChild(buildPayouts(row, detail));
    panel.appendChild(buildOrders(detail));
    td.appendChild(panel);
    tr.appendChild(td);
    return tr;
  }

  /* ---------- data ---------- */

  function loadDetail(code) {
    state.details[code] = { status: "loading" };
    return post(REPORT, { code: code }).then(function (res) {
      if (res.status === 200 && res.data && res.data.ok) {
        state.details[code] = { status: "ok", data: res.data };
      } else {
        state.details[code] = { status: "error", error: (res.data && res.data.error) || "Could not load the details." };
      }
    }).catch(function () {
      state.details[code] = { status: "error", error: "Could not reach the report service." };
    });
  }

  function loadListing(password, opts) {
    opts = opts || {};
    if (!opts.quiet) { setStatus("Loading…", false); els.submit.disabled = true; }
    state.password = password || state.password;

    return post(REPORT, {}).then(function (res) {
      els.submit.disabled = false;
      if (res.status === 200 && res.data && res.data.ok) {
        state.data = res.data;
        setStatus("", false);
        els.rate.textContent = Math.round((res.data.commission_rate || 0) * 10000) / 100 + "%";
        els.generated.textContent = res.data.generated_at ? new Date(res.data.generated_at).toLocaleString() : "—";
        els.printMeta.textContent = "Generated " + els.generated.textContent + ". Contains personal data: handle with care.";
        els.gate.hidden = true;
        els.report.hidden = false;
        renderAll();
        return true;
      }
      // 401 wrong password, 503 not configured yet, 500 read failure —
      // surface the server's own message, it names the fix.
      var message = (res.data && res.data.error) || "Could not load the report.";
      if (opts.quiet) setNotice(message, true); else setStatus(message, true);
      state.password = opts.quiet ? state.password : "";
      return false;
    }).catch(function (err) {
      els.submit.disabled = false;
      var message = "Could not reach the report service. If you're viewing this page outside " +
        "Cloudflare Pages, the /api/ functions aren't running.";
      if (opts.quiet) setNotice(message, true); else setStatus(message, true);
      return false;
    });
  }

  /** Re-reads the listing (totals + balances) and re-fetches one affiliate's detail. */
  function refreshAfterChange(code) {
    return Promise.all([loadListing("", { quiet: true }), loadDetail(code)]).then(function () {
      renderAll();
    });
  }

  /* ---------- actions ---------- */

  function toggleRow(code) {
    if (state.expanded[code]) {
      delete state.expanded[code];
      renderTable();
      return;
    }
    state.expanded[code] = true;
    var needsLoad = !state.details[code] || state.details[code].status !== "ok";
    if (needsLoad) state.details[code] = { status: "loading" };
    renderTable();
    if (needsLoad) loadDetail(code).then(renderTable);
    focusToggle(code);
  }

  function focusToggle(code) {
    var btn = els.rows.querySelector('.aff-toggle[data-code="' + code + '"]');
    if (btn) btn.focus();
  }

  function submitPayout(form) {
    var code = form.getAttribute("data-code");
    var row = findRow(code);
    if (!row || state.busy[code]) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }

    var amount = Number(form.elements.amount.value);
    var date = form.elements.date.value;
    if (!isFinite(amount) || amount <= 0) { setNotice("Enter an amount greater than zero.", true); return; }

    var label = (row.name || row.code) + " (" + row.code + ")";
    var ok = window.confirm(
      "Record a payment of " + money(amount) + " to " + label + ", dated " + date + "?\n\n" +
      "Only record it if you have actually sent the money. You can remove a mistaken entry afterwards."
    );
    if (!ok) return;

    state.busy[code] = true;
    renderTable();
    post(PAYOUT, {
      code: code,
      amount_ngn: amount,
      paid_on: date,
      reference: form.elements.reference.value.trim(),
      note: form.elements.note.value.trim(),
      email_receipt: form.elements.email_receipt.checked
    }).then(function (res) {
      state.busy[code] = false;
      if (res.status === 200 && res.data && res.data.ok) {
        delete state.drafts[code];                 // next form prefills with the NEW balance
        var recorded = "Recorded " + money(res.data.amount_ngn) + " paid to " + label + ".";
        if (res.data.email_requested && !res.data.notified) {
          // The payment IS saved; only the email failed.
          setNotice("Payment recorded, but the email failed: " + (res.data.error || "unknown error") +
            ". You can resend it from the payment list below.", true);
        } else {
          setNotice(recorded + (res.data.notified ? " Receipt emailed." : ""), false);
        }
        return refreshAfterChange(code);
      }
      setNotice((res.data && res.data.error) || "Could not record the payment.", true);
      renderTable();
    }).catch(function () {
      state.busy[code] = false;
      setNotice("Could not reach the service. The payment was NOT recorded.", true);
      renderTable();
    });
  }

  function removePayout(code, key) {
    var detail = state.details[code];
    var entry = detail && detail.data && detail.data.payouts_detail.filter(function (p) { return p.key === key; })[0];
    var what = entry ? money(entry.amount_ngn) + " dated " + shortDate(entry.paid_on) : "this payment";
    if (!window.confirm("Remove the recorded payment of " + what + "?\n\nThis only deletes the entry in this report; it does not reverse any money already sent.")) return;
    post(PAYOUT, { delete_key: key }).then(function (res) {
      if (res.status === 200 && res.data && res.data.ok) {
        setNotice("Removed the recorded payment.", false);
        return refreshAfterChange(code);
      }
      setNotice((res.data && res.data.error) || "Could not remove that payment.", true);
    }).catch(function () {
      setNotice("Could not reach the service. Nothing was removed.", true);
    });
  }

  function resendReceipt(code, key) {
    var detail = state.details[code];
    var entry = detail && detail.data && detail.data.payouts_detail.filter(function (p) { return p.key === key; })[0];
    var what = entry ? money(entry.amount_ngn) + " payment of " + shortDate(entry.paid_on) : "this payment";
    var row = findRow(code);
    if (!window.confirm("Email the receipt for the " + what + " to " + ((row && row.name) || code) + " (the address on file)?")) return;
    state.busy["receipt:" + key] = true;
    renderTable();
    post(PAYOUT, { payout_key: key }).then(function (res) {
      state.busy["receipt:" + key] = false;
      if (res.status === 200 && res.data && res.data.ok) {
        setNotice("Receipt emailed.", false);
      } else {
        setNotice("The email failed: " + ((res.data && res.data.error) || "could not reach the service") + ". The payment itself is unaffected.", true);
      }
      return loadDetail(code);
    }).catch(function () {
      state.busy["receipt:" + key] = false;
      setNotice("Could not reach the service. Nothing was sent.", true);
    }).then(renderTable);
  }

  function copyAccount(code, button) {
    var row = findRow(code);
    if (!row || !row.payout || !row.payout.account_number) return;
    var original = button.textContent;
    copyText(row.payout.account_number).then(function () {
      button.textContent = "Copied";
    }, function () {
      button.textContent = "Copy failed";
    }).then(function () {
      window.setTimeout(function () { button.textContent = original; }, 1600);
    });
  }

  /* ---------- CSV ---------- */

  /** Spreadsheet formula injection guard: a cell starting with = + - @ would
   *  be run as a formula by Excel/Sheets, and names come from a public form. */
  function csvText(value) {
    var s = String(value === null || value === undefined ? "" : value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return csvQuote(s);
  }
  function csvQuote(s) {
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** Account and phone numbers are digit strings that often start with 0,
   *  which a spreadsheet would silently drop. ="0123456789" makes both Excel
   *  and Google Sheets keep them as text. */
  function csvDigits(value) {
    var s = String(value || "");
    if (/^\d+$/.test(s)) return csvQuote('="' + s + '"');
    return csvText(s);
  }

  function buildCsv(rows) {
    var header = ["Code", "Name", "Email", "Phone", "Bank", "Account number", "Account holder",
                  "Orders", "Sales (NGN)", "Earned (NGN)", "Paid (NGN)", "Balance due (NGN)"];
    var lines = [header.map(csvQuote).join(",")];
    rows.forEach(function (r) {
      var p = r.payout || {};
      lines.push([
        csvText(r.code), csvText(r.name), csvText(r.email), csvDigits(r.phone),
        csvText(p.bank_name), csvDigits(p.account_number), csvText(p.account_holder),
        r.orders, r.total_sales_ngn, r.commission_earned_ngn, r.paid_ngn, r.balance_due_ngn
      ].join(","));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  function exportCsv() {
    var rows = visibleRows();
    if (!rows.length) { setNotice("Nothing to export with the current filters.", true); return; }
    var blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "affiliate-payouts-" + todayLocal() + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setNotice("Exported " + rows.length + " row" + (rows.length === 1 ? "" : "s") + ". The file contains bank details: store it securely and delete it when you are done.", false);
  }

  // Exposed for tests only: pure functions, no state.
  window.__adminReferralsTest = { mask: mask, buildCsv: buildCsv, csvText: csvText, csvDigits: csvDigits };

  /* ---------- wiring ---------- */

  document.addEventListener("DOMContentLoaded", function () {
    var $ = function (id) { return document.getElementById(id); };
    els.gate = $("admin-gate");
    els.form = $("admin-form");
    els.password = $("admin-password");
    els.submit = $("admin-submit");
    els.status = $("admin-status");
    els.report = $("admin-report");
    els.notice = $("admin-notice");
    els.rows = $("admin-rows");
    els.rate = $("admin-rate");
    els.generated = $("admin-generated");
    els.printMeta = $("admin-print-meta");
    els.empty = $("admin-empty");
    els.tableWrap = document.querySelector(".admin-table-wrap");
    els.refresh = $("admin-refresh");
    els.print = $("admin-print");
    els.search = $("admin-search");
    els.filterDue = $("admin-filter-due");
    els.hideZero = $("admin-hide-zero");
    els.export = $("admin-export");
    els.footLabel = $("admin-foot-label");
    els.totalOrders = $("admin-total-orders");
    els.totalSales = $("admin-total-sales");
    els.totalEarned = $("admin-total-earned");
    els.totalPaid = $("admin-total-paid");
    els.totalBalance = $("admin-total-balance");
    els.sumSales = $("sum-sales");
    els.sumEarned = $("sum-earned");
    els.sumPaid = $("sum-paid");
    els.sumBalance = $("sum-balance");
    els.sumOverpaid = $("sum-overpaid");
    els.sumActive = $("sum-active");
    els.sumRegistered = $("sum-registered");
    els.sumOrders = $("sum-orders");

    if (!els.form) return;

    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!els.form.checkValidity()) { els.form.reportValidity(); return; }
      loadListing(els.password.value);
    });

    els.refresh.addEventListener("click", function () {
      if (!state.password) return;
      setNotice("", false);
      loadListing("", { quiet: true }).then(function () {
        // Expanded rows keep their (possibly stale) detail until re-fetched.
        Object.keys(state.expanded).forEach(function (code) { loadDetail(code).then(renderTable); });
      });
    });

    els.print.addEventListener("click", function () { window.print(); });
    els.export.addEventListener("click", exportCsv);
    [els.search, els.filterDue, els.hideZero].forEach(function (node) {
      node.addEventListener(node === els.search ? "input" : "change", function () { if (state.data) renderTable(); });
    });

    // One delegated handler for everything inside the table.
    els.rows.addEventListener("click", function (e) {
      var target = e.target.closest("button");
      if (!target) return;
      var code = target.getAttribute("data-code");
      if (target.classList.contains("aff-toggle")) { toggleRow(code); return; }
      var action = target.getAttribute("data-action");
      if (action === "reveal") {
        if (state.revealed[code]) delete state.revealed[code]; else state.revealed[code] = true;
        renderTable();
      } else if (action === "copy") {
        copyAccount(code, target);
      } else if (action === "remove-payout") {
        removePayout(code, target.getAttribute("data-key"));
      } else if (action === "resend-receipt") {
        resendReceipt(code, target.getAttribute("data-key"));
      }
    });

    els.rows.addEventListener("submit", function (e) {
      var form = e.target.closest("form.payout-form");
      if (!form) return;
      e.preventDefault();
      submitPayout(form);
    });

    // Keep what was typed if the table re-renders (e.g. a filter change).
    els.rows.addEventListener("input", function (e) {
      var input = e.target;
      var form = input.closest && input.closest("form.payout-form");
      if (!form) return;
      var code = form.getAttribute("data-code");
      state.drafts[code] = {
        amount: form.elements.amount.value,
        date: form.elements.date.value,
        reference: form.elements.reference.value,
        note: form.elements.note.value,
        email: form.elements.email_receipt.checked
      };
    });
  });
})();
