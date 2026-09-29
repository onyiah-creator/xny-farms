/**
 * GET/POST /api/get-my-stats?code=CODE — Cloudflare Pages Function
 *
 * Public, unauthenticated self-check for a single affiliate. Returns the
 * totals for ONE code and nothing else — no other affiliate's figures, no
 * customer details, no order-level data, and no list of which codes exist.
 *
 * Response: { ok, code, approved, orders, total_sales_ngn, commission_ngn }
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
  try {
    approved = Boolean(await env.REFERRALS_KV.get(`affiliate:${code}`));
  } catch (err) {
    approved = false;
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

  return json({
    ok: true,
    code,
    approved,
    commission_rate: COMMISSION_RATE,
    orders,
    total_sales_ngn: Math.round(sales * 100) / 100,
    commission_ngn: Math.round(commission * 100) / 100,
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
