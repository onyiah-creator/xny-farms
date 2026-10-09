/**
 * POST /api/get-referrals — Cloudflare Pages Function
 *
 * Password-gated payout report, consumed by admin-referrals.html: per
 * affiliate and in total, what was earned, what has been paid, what is still
 * owed, and where to send the money.
 *
 * Request body (JSON): { "password": "…" }                  -> the listing
 *                      { "password": "…", "code": "ADE01" }  -> one affiliate's detail
 * Checked against the ADMIN_REPORT_PASSWORD environment variable, set in
 * the Pages project under Settings → Environment variables (see README).
 *
 * ── Listing response ──
 *   {
 *     ok: true, commission_rate: 0.08, generated_at: "…ISO…",
 *     rows: [{
 *       code, name, email, phone, approved_at, unregistered,
 *       orders, total_sales_ngn,
 *       commission_ngn, commission_earned_ngn,   // same number; the first is the original field name
 *       paid_ngn, balance_due_ngn,               // balance is earned − paid, never negative
 *       overpaid, overpaid_ngn,                  // paid exceeded earned
 *       last_order_at,
 *       payout: { bank_name, account_number, account_holder } | null
 *     }],                                        // one per APPROVED affiliate (zero orders included),
 *                                                // plus any code with orders/payouts but no affiliate
 *                                                // record (unregistered: true). Largest balance first.
 *     totals: { affiliates, unregistered_codes, active_affiliates (approved, with ≥1 order), orders, total_sales_ngn,
 *               commission_ngn, commission_earned_ngn, paid_ngn, balance_due_ngn, overpaid_ngn }
 *   }
 *   totals.balance_due_ngn is the sum of the rows' balances, so one affiliate's
 *   overpayment never cancels out another's debt; overpayments are totalled
 *   separately in overpaid_ngn.
 *
 * ── Detail response (request with "code") ──
 *   { ok, code, summary: {orders, total_sales_ngn, commission_earned_ngn, paid_ngn, balance_due_ngn, overpaid},
 *     orders_detail:  [{ tx_ref, timestamp, order_total_ngn, commission_ngn }]        newest first,
 *     payouts_detail: [{ key, amount_ngn, paid_on, reference, note,
 *                        notified_email: { at, ok, error } | null,   // receipt email status
 *                        message }]                                  // WhatsApp/SMS text, built here
 *                                                                     // newest first,
 *     contact: { phone_international: "2348…" | null, has_phone, has_email } }
 *   message, notified_email and contact exist for the admin's buttons only. They carry the
 *   phone number and the bank name + LAST FOUR digits; this password-gated endpoint is the
 *   only place they are returned (the listing and every public endpoint omit them).
 *   Per-order and per-payout rows are only built for the one affiliate being
 *   expanded, so the listing stays at one list() per prefix.
 *
 * ── Where the figures come from ──
 *   referral:{CODE}:{tx_ref}   orders  — sums read from KV METADATA (no get per record)
 *   payout:{CODE}:{ts}-{id}    payouts — sums read from KV METADATA
 *   affiliate:{CODE}           who is approved; metadata {n,e,at,k}
 *   application:{ts}-{id}      bank details + phone; ONE get() per affiliate
 * Records written before metadata existed fall back to reading the value.
 *
 * ── Payout details: how an affiliate is joined to their application ──
 *   1. affiliate.application_key (stored by register-affiliate.js since the
 *      key was introduced), if that application still exists;
 *   2. otherwise the MOST RECENT application whose email matches the
 *      affiliate's (case-insensitive) — for affiliates approved before the
 *      link existed. This needs the application values, so it reads up to
 *      MAX_FALLBACK_SCAN of the newest ones, once, and only when some
 *      affiliate needs it;
 *   3. otherwise payout: null.
 *   An application whose bank fields are all blank also yields payout: null.
 *
 * Note: "total_sales_ngn" is the sum of the COMMISSIONABLE subtotals
 * (delivery fees excluded), which is the base the 8% is charged on.
 * Money is added up in kobo (integers) so 0.1 + 0.2 never shows up as
 * 0.30000000000000004.
 */

import {
  COMMISSION_RATE, REFERRAL_PREFIX, PAYOUT_PREFIX,
  toKobo, fromKobo, figures, listAll, mapBatched, getJson,
  loadOrders, loadPayoutTotals, loadAffiliates, loadAffiliate, resolvePayoutDetails,
  normalisePhone, last4, buildReceiptMessage
} from "../_lib/payouts.js";
import { SITE_URL } from "../_lib/email.js";

const DETAIL_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

/**
 * Length-independent comparison, so a wrong password can't be narrowed
 * down by timing. A length mismatch still returns early — that leak is
 * inherent to comparing strings of different sizes and is not sensitive
 * on its own.
 */
function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}


async function buildListing(kv) {
  const [affiliates, orders, payouts] = await Promise.all([
    loadAffiliates(kv),
    loadOrders(kv, REFERRAL_PREFIX),
    loadPayoutTotals(kv, PAYOUT_PREFIX)
  ]);
  const details = await resolvePayoutDetails(kv, affiliates);

  const agg = new Map();                                        // code -> running totals, in kobo
  const slot = (code) => {
    if (!agg.has(code)) agg.set(code, { orders: 0, salesK: 0, earnedK: 0, paidK: 0, last: null });
    return agg.get(code);
  };
  for (const o of orders) {
    const a = slot(o.code);
    a.orders += 1;
    a.salesK += toKobo(o.total);
    a.earnedK += toKobo(o.commission);
    if (o.timestamp && (!a.last || o.timestamp > a.last)) a.last = o.timestamp;
  }
  for (const p of payouts) slot(p.code).paidK += toKobo(p.amount);

  const registered = new Map(affiliates.map((a) => [a.code, a]));
  const codes = new Set([...registered.keys(), ...agg.keys()]);

  const rows = [];
  for (const code of codes) {
    const a = agg.get(code) || { orders: 0, salesK: 0, earnedK: 0, paidK: 0, last: null };
    const aff = registered.get(code);
    const extra = aff ? details.get(code) : null;
    rows.push({
      code,
      name: aff ? aff.name : "",
      email: aff ? aff.email : "",
      phone: extra ? extra.phone : "",
      approved_at: aff ? aff.approved_at : null,
      unregistered: !aff,
      orders: a.orders,
      total_sales_ngn: fromKobo(a.salesK),
      ...figures(a.earnedK, a.paidK),
      last_order_at: a.last,
      payout: extra ? extra.payout : null
    });
  }
  rows.sort((x, y) =>
    y.balance_due_ngn - x.balance_due_ngn ||
    y.commission_earned_ngn - x.commission_earned_ngn ||
    x.code.localeCompare(y.code)
  );

  const sum = (pick) => rows.reduce((acc, r) => acc + toKobo(pick(r)), 0);
  const totals = {
    affiliates: rows.filter((r) => !r.unregistered).length,
    unregistered_codes: rows.filter((r) => r.unregistered).length,
    active_affiliates: rows.filter((r) => !r.unregistered && r.orders > 0).length,
    orders: rows.reduce((acc, r) => acc + r.orders, 0),
    total_sales_ngn: fromKobo(sum((r) => r.total_sales_ngn)),
    commission_ngn: fromKobo(sum((r) => r.commission_earned_ngn)),
    commission_earned_ngn: fromKobo(sum((r) => r.commission_earned_ngn)),
    paid_ngn: fromKobo(sum((r) => r.paid_ngn)),
    balance_due_ngn: fromKobo(sum((r) => r.balance_due_ngn)),
    overpaid_ngn: fromKobo(sum((r) => r.overpaid_ngn))
  };
  return { rows, totals };
}

async function buildDetail(kv, code) {
  const [orders, payoutKeys] = await Promise.all([
    loadOrders(kv, `${REFERRAL_PREFIX}${code}:`),            // trailing colon: ADE must not match ADEBAYO01
    listAll(kv, `${PAYOUT_PREFIX}${code}:`)
  ]);

  const payouts = (await mapBatched(payoutKeys, async (key) => {
    const value = await getJson(kv, key.name);
    const meta = key.metadata || {};
    const amount = value ? Number(value.amount_ngn) : Number(meta.a);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      key: key.name,
      amount_ngn: amount,
      paid_on: (value && value.paid_on) || meta.ts || null,
      reference: (value && value.reference) || "",
      note: (value && value.note) || "",
      // { at, ok, error } once a receipt email has been attempted; null = never emailed
      notified_email: (value && value.notified_email) || null
    };
  })).filter(Boolean);

  orders.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  payouts.sort((a, b) => String(b.paid_on || "").localeCompare(String(a.paid_on || "")) || b.key.localeCompare(a.key));

  const earnedK = orders.reduce((acc, o) => acc + toKobo(o.commission), 0);
  const paidK = payouts.reduce((acc, p) => acc + toKobo(p.amount_ngn), 0);
  const f = figures(earnedK, paidK);

  // For the WhatsApp / SMS buttons. Built here so the browser never recomputes
  // totals. The phone, bank name and last four digits are returned to this
  // password-gated endpoint only: no public endpoint carries them.
  const affiliate = await loadAffiliate(kv, code);
  let phone = "";
  let payoutInfo = null;
  if (affiliate) {
    const resolved = (await resolvePayoutDetails(kv, [affiliate])).get(code);
    phone = resolved ? resolved.phone : "";
    payoutInfo = resolved ? resolved.payout : null;
  }
  const statsLink = `${SITE_URL}/my-stats.html?code=${encodeURIComponent(code)}`;
  for (const p of payouts) {
    p.message = buildReceiptMessage({
      name: affiliate ? affiliate.name : "",
      amount: p.amount_ngn,
      bankName: payoutInfo ? payoutInfo.bank_name : "",
      last4: payoutInfo ? last4(payoutInfo.account_number) : "",
      paidOn: p.paid_on,
      reference: p.reference,
      paidToDate: f.paid_ngn,
      balanceDue: f.balance_due_ngn,
      statsLink
    });
  }

  return {
    code,
    contact: { phone_international: normalisePhone(phone), has_phone: Boolean(phone), has_email: Boolean(affiliate && affiliate.email) },
    summary: {
      orders: orders.length,
      total_sales_ngn: fromKobo(orders.reduce((acc, o) => acc + toKobo(o.total), 0)),
      commission_earned_ngn: f.commission_earned_ngn,
      paid_ngn: f.paid_ngn,
      balance_due_ngn: f.balance_due_ngn,
      overpaid: f.overpaid
    },
    orders_detail: orders.map((o) => ({
      tx_ref: o.tx_ref,
      timestamp: o.timestamp,
      order_total_ngn: o.total,
      commission_ngn: fromKobo(toKobo(o.commission))
    })),
    payouts_detail: payouts
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ADMIN_REPORT_PASSWORD) {
    return json({
      ok: false,
      error:
        "ADMIN_REPORT_PASSWORD is not set. Add it to this Pages project under " +
        "Settings → Environment variables, then redeploy."
    }, 503);
  }

  if (!env.REFERRALS_KV) {
    return json({
      ok: false,
      error:
        "REFERRALS_KV is not bound. Create a KV namespace named REFERRALS_KV and bind it " +
        "to this Pages project under Settings → Functions → KV namespace bindings."
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: "Body must be valid JSON." }, 400);
  }
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "Body must be a JSON object." }, 400);
  }

  const supplied = typeof body.password === "string" ? body.password : "";
  if (!timingSafeEqual(supplied, env.ADMIN_REPORT_PASSWORD)) {
    return json({ ok: false, error: "Incorrect password." }, 401);
  }

  // Detail for one affiliate (the expanded row).
  if (body.code !== undefined) {
    const rawCode = typeof body.code === "string" ? body.code.trim() : "";
    if (!DETAIL_CODE_PATTERN.test(rawCode)) {
      return json({ ok: false, error: "Invalid code." }, 400);
    }
    try {
      return json({ ok: true, generated_at: new Date().toISOString(), ...(await buildDetail(env.REFERRALS_KV, rawCode.toUpperCase())) });
    } catch (err) {
      return json({ ok: false, error: "Could not read that affiliate's records." }, 500);
    }
  }

  try {
    const { rows, totals } = await buildListing(env.REFERRALS_KV);
    return json({
      ok: true,
      commission_rate: COMMISSION_RATE,
      generated_at: new Date().toISOString(),
      rows,
      totals
    });
  } catch (err) {
    return json({ ok: false, error: "Could not read referral records." }, 500);
  }
}
