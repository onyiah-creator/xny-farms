/**
 * GET/POST /api/get-my-stats?code=CODE — Cloudflare Pages Function
 *
 * Public, unauthenticated self-check for a single affiliate. Returns the
 * totals for ONE code and nothing else — no other affiliate's figures, no
 * customer details, no order-level data, and no list of which codes exist.
 *
 * A suspended affiliate gets { ok, code, approved: true, paused: true } and nothing else.
 *
 * Response: { ok, code, approved, orders, total_sales_ngn, commission_ngn,
 *             paid_ngn, balance_due_ngn, payments: [{ paid_on, amount_ngn, reference }] }
 *
 * paid_ngn is the total the admin has recorded as sent to this code
 * (payout:{CODE}:… records, summed from metadata); balance_due_ngn is earned
 * minus paid, never negative. Bank details, payout references and notes are
 * NEVER returned here. The payments list carries date, amount and reference
 * only (newest first); the payout records' notes, receipt status and contact
 * details are never put in the response.
 *
 * Scoping: referral records are keyed "referral:{CODE}:{tx_ref}", and this
 * lists with the prefix "referral:{CODE}:" — note the TRAILING COLON. It
 * matters: without it, prefix "referral:ADE" would also sweep up
 * "referral:ADEBAYO01:…", leaking one affiliate's sales into another's
 * total.
 *
 * Codes are uppercased to match how they are stored at approval.
 *
 * Known limitation (documented in the README): because this needs no
 * password, anyone who guesses or is told a code can see that code's
 * totals. It exposes no names, emails or customer data, but keep codes
 * non-obvious if you consider earnings sensitive.
 */

const COMMISSION_RATE = 0.08;
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAYMENTS_DETAILED = 50;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function handle(request, env) {
  if (!env.REFERRALS_KV) {
    return json({
      ok: false,
      error:
        "REFERRALS_KV is not bound. Create a KV namespace named REFERRALS_KV and bind it " +
        "to this Pages project under Settings → Functions → KV namespace bindings."
    }, 503);
  }

  let rawCode = new URL(request.url).searchParams.get("code") || "";
  if (!rawCode && request.method === "POST") {
    try {
      const body = await request.json();
      if (typeof body.code === "string") rawCode = body.code;
    } catch (err) { /* fall through to the empty-code response */ }
  }
  rawCode = rawCode.trim();

  if (!rawCode) {
    return json({ ok: false, error: "No referral code supplied." }, 400);
  }
  if (!CODE_PATTERN.test(rawCode)) {
    return json({ ok: false, error: "That doesn't look like a valid referral code." }, 400);
  }
  const code = rawCode.toUpperCase();

  let approved = false;
  let suspended = false;
  try {
    const raw = await env.REFERRALS_KV.get(`affiliate:${code}`);
    approved = Boolean(raw);
    if (raw) {
      try { suspended = JSON.parse(raw).status === "suspended"; } catch (err) { suspended = false; }
    }
  } catch (err) {
    approved = false;
  }

  // A paused account shows a neutral message and no figures; the person is asked to get in touch.
  if (suspended) {
    return json({ ok: true, code, approved: true, paused: true });
  }

  let orders = 0;
  let sales = 0;
  let commission = 0;
  let lastOrderAt = null;
  let cursor;
  let listComplete = false;

  try {
    while (!listComplete) {
      const page = await env.REFERRALS_KV.list({
        prefix: `referral:${code}:`,
        cursor,
        limit: 1000
      });

      for (const key of page.keys) {
        const meta = key.metadata;
        let total;
        let earned;
        let timestamp;

        if (meta && typeof meta.t === "number") {
          total = meta.t;
          earned = typeof meta.m === "number" ? meta.m : meta.t * COMMISSION_RATE;
          timestamp = meta.ts;
        } else {
          const raw = await env.REFERRALS_KV.get(key.name);
          if (!raw) continue;
          try {
            const value = JSON.parse(raw);
            total = Number(value.order_total_ngn);
            earned = Number(value.commission_ngn);
            timestamp = value.timestamp;
          } catch (err) {
            continue;
          }
        }

        if (!Number.isFinite(total)) continue;
        if (!Number.isFinite(earned)) earned = total * COMMISSION_RATE;

        orders += 1;
        sales += total;
        commission += earned;
        if (timestamp && (!lastOrderAt || timestamp > lastOrderAt)) lastOrderAt = timestamp;
      }

      cursor = page.cursor;
      listComplete = page.list_complete === true || !page.cursor;
    }
  } catch (err) {
    return json({ ok: false, error: "Could not read your referral records." }, 500);
  }

  // Payments the admin has recorded for this code. Metadata only (no get()),
  // so nothing but the amount is ever read. The trailing colon scopes the
  // prefix to this code, exactly as for referrals above.
  let paidKobo = 0;
  const payments = [];          // { key, paid_on, amount_ngn, reference }
  try {
    cursor = undefined;
    listComplete = false;
    while (!listComplete) {
      const page = await env.REFERRALS_KV.list({
        prefix: `payout:${code}:`,
        cursor,
        limit: 1000
      });
      for (const key of page.keys) {
        const meta = key.metadata || {};
        let amount = typeof meta.a === "number" ? meta.a : NaN;
        let paidOn = typeof meta.ts === "string" ? meta.ts : null;
        let reference = null;      // filled in below for the newest few
        if (!Number.isFinite(amount) || !paidOn) {
          const raw = await env.REFERRALS_KV.get(key.name);
          try {
            const value = JSON.parse(raw);
            if (!Number.isFinite(amount)) amount = Number(value.amount_ngn);
            if (!paidOn) paidOn = value.paid_on || null;
            reference = typeof value.reference === "string" ? value.reference : "";
          } catch (err) { continue; }
        }
        if (Number.isFinite(amount) && amount > 0) {
          paidKobo += Math.round(amount * 100);
          payments.push({ key: key.name, paid_on: paidOn, amount_ngn: Math.round(amount * 100) / 100, reference });
        }
      }
      cursor = page.cursor;
      listComplete = page.list_complete === true || !page.cursor;
    }

    // Newest first. The reference lives only in the record's value, so it is
    // read for the newest MAX_PAYMENTS_DETAILED payments only: this endpoint is
    // public, and must not be a way to make the site do hundreds of reads.
    payments.sort((a, b) => String(b.paid_on || "").localeCompare(String(a.paid_on || "")) || b.key.localeCompare(a.key));
    for (const p of payments.slice(0, MAX_PAYMENTS_DETAILED)) {
      if (p.reference !== null) continue;
      try {
        const value = JSON.parse(await env.REFERRALS_KV.get(p.key));
        p.reference = typeof value.reference === "string" ? value.reference : "";
      } catch (err) { p.reference = ""; }
    }
  } catch (err) {
    return json({ ok: false, error: "Could not read your referral records." }, 500);
  }
  const earnedKobo = Math.round(commission * 100);

  return json({
    ok: true,
    code,
    approved,
    commission_rate: COMMISSION_RATE,
    orders,
    total_sales_ngn: Math.round(sales * 100) / 100,
    commission_ngn: Math.round(commission * 100) / 100,
    paid_ngn: paidKobo / 100,
    balance_due_ngn: Math.max(0, earnedKobo - paidKobo) / 100,
    // Date, amount and reference only: never the note, the receipt status or any bank or contact detail.
    payments: payments.map((p) => ({ paid_on: p.paid_on, amount_ngn: p.amount_ngn, reference: p.reference || "" })),
    last_order_at: lastOrderAt,
    generated_at: new Date().toISOString()
  });
}

export async function onRequestGet(context) {
  return handle(context.request, context.env);
}

export async function onRequestPost(context) {
  return handle(context.request, context.env);
}
