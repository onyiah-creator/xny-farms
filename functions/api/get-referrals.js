/**
 * POST /api/get-referrals — Cloudflare Pages Function
 *
 * Password-gated referral report, consumed by admin-referrals.html.
 * Returns every logged referral aggregated by affiliate code.
 *
 * Request body (JSON): { "password": "…" }
 * Checked against the ADMIN_REPORT_PASSWORD environment variable, set in
 * the Pages project under Settings → Environment variables (see README).
 *
 * Response:
 *   {
 *     ok: true,
 *     commission_rate: 0.08,
 *     generated_at: "…ISO…",
 *     rows: [{ code, orders, total_sales_ngn, commission_ngn, last_order_at }],
 *     totals: { orders, total_sales_ngn, commission_ngn }
 *   }
 *
 * Aggregation reads the figures from each key's KV metadata, so the whole
 * report costs one list() call per 1000 records rather than a get() per
 * record. Records written before metadata existed (or with it missing)
 * fall back to reading the value itself.
 *
 * Note: "total_sales_ngn" is the sum of the COMMISSIONABLE subtotals
 * (delivery fees excluded), which is the base the 8% is charged on.
 */

const COMMISSION_RATE = 0.08;
const KEY_PREFIX = "referral:";

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

  const supplied = typeof body.password === "string" ? body.password : "";
  if (!timingSafeEqual(supplied, env.ADMIN_REPORT_PASSWORD)) {
    return json({ ok: false, error: "Incorrect password." }, 401);
  }

  const byCode = new Map();
  let cursor;
  let listComplete = false;

  try {
    while (!listComplete) {
      const page = await env.REFERRALS_KV.list({ prefix: KEY_PREFIX, cursor, limit: 1000 });

      for (const key of page.keys) {
        const meta = key.metadata;
        let code;
        let total;
        let commission;
        let timestamp;

        if (meta && typeof meta.t === "number") {
          code = meta.c;
          total = meta.t;
          commission = typeof meta.m === "number" ? meta.m : meta.t * COMMISSION_RATE;
          timestamp = meta.ts;
        } else {
          // Older record, or metadata unavailable — read the value.
          const raw = await env.REFERRALS_KV.get(key.name);
          if (!raw) continue;
          try {
            const value = JSON.parse(raw);
            code = value.ref_code;
            total = Number(value.order_total_ngn);
            commission = Number(value.commission_ngn);
            timestamp = value.timestamp;
          } catch (err) {
            continue;
          }
        }

        // Last resort: recover the code from the key itself
        // (referral:{code}:{tx_ref}).
        if (!code) code = key.name.split(":")[1] || "(unknown)";
        if (!Number.isFinite(total)) continue;
        if (!Number.isFinite(commission)) commission = total * COMMISSION_RATE;

        const row = byCode.get(code) || {
          code,
          orders: 0,
          total_sales_ngn: 0,
          commission_ngn: 0,
          last_order_at: null
        };
        row.orders += 1;
        row.total_sales_ngn += total;
        row.commission_ngn += commission;
        if (timestamp && (!row.last_order_at || timestamp > row.last_order_at)) {
          row.last_order_at = timestamp;
        }
        byCode.set(code, row);
      }

      cursor = page.cursor;
      listComplete = page.list_complete === true || !page.cursor;
    }
  } catch (err) {
    return json({ ok: false, error: "Could not read referral records." }, 500);
  }

  const rows = Array.from(byCode.values())
    .map((row) => ({
      ...row,
      total_sales_ngn: Math.round(row.total_sales_ngn * 100) / 100,
      commission_ngn: Math.round(row.commission_ngn * 100) / 100
    }))
    .sort((a, b) => b.commission_ngn - a.commission_ngn);

  const totals = rows.reduce(
    (acc, row) => ({
      orders: acc.orders + row.orders,
      total_sales_ngn: Math.round((acc.total_sales_ngn + row.total_sales_ngn) * 100) / 100,
      commission_ngn: Math.round((acc.commission_ngn + row.commission_ngn) * 100) / 100
    }),
    { orders: 0, total_sales_ngn: 0, commission_ngn: 0 }
  );

  return json({
    ok: true,
    commission_rate: COMMISSION_RATE,
    generated_at: new Date().toISOString(),
    rows,
    totals
  });
}
