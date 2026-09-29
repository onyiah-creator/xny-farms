/**
 * POST /api/log-referral — Cloudflare Pages Function
 *
 * Records one referred order against an affiliate code so commission can
 * be reported later. Called by js/referral.js after a successful
 * Flutterwave payment on cart.html.
 *
 * Request body (JSON):
 *   ref_code         string  affiliate code captured from ?ref=
 *   order_total_ngn  number  COMMISSIONABLE amount — the order subtotal,
 *                            excluding delivery. Commission is 8% of this.
 *   tx_ref           string  Flutterwave transaction reference
 *   timestamp        string  ISO 8601 (optional; defaults to now)
 *   gross_total_ngn  number  optional, subtotal + delivery, for reconciliation
 *
 * Storage: Cloudflare KV, bound as REFERRALS_KV (create the namespace and
 * binding in the Pages project — see README, "Referral / affiliate
 * programme"). Records are keyed:
 *
 *   referral:{ref_code}:{tx_ref}
 *
 * Keying by tx_ref makes writes idempotent: a retry, a double-fire, or a
 * customer refreshing the confirmation page rewrites the same key instead
 * of double-counting the sale.
 *
 * The same figures are duplicated into KV metadata so the report endpoint
 * can aggregate straight from a list() call instead of issuing one get()
 * per record.
 *
 * SECURITY / TRUST — read before relying on these numbers for payouts.
 * This endpoint is public and unauthenticated, and it trusts the amount
 * the browser sends. That is the same trust boundary the checkout itself
 * already has (payment success is taken from Flutterwave's client-side
 * callback and is not server-verified — see README "Payments &
 * Security"). Anyone who finds this URL could POST fabricated sales.
 * Before paying real commission, reconcile each tx_ref against the
 * Flutterwave dashboard. The proper fix is the same fast-follow already
 * recommended for checkout: verify tx_ref server-side with Flutterwave's
 * Verify Transaction API using the secret key, and record only what that
 * call confirms.
 */

export const COMMISSION_RATE = 0.08; // 8% of the order subtotal

const REF_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TX_REF_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;
const MAX_ORDER_NGN = 100000000; // sanity ceiling, rejects absurd payloads

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

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

  const refCode = typeof body.ref_code === "string" ? body.ref_code.trim() : "";
  if (!REF_CODE_PATTERN.test(refCode)) {
    return json({ ok: false, error: "Invalid ref_code." }, 400);
  }

  const txRef = typeof body.tx_ref === "string" ? body.tx_ref.trim() : "";
  if (!TX_REF_PATTERN.test(txRef)) {
    return json({ ok: false, error: "Invalid tx_ref." }, 400);
  }

  const orderTotal = Number(body.order_total_ngn);
  if (!Number.isFinite(orderTotal) || orderTotal <= 0 || orderTotal > MAX_ORDER_NGN) {
    return json({ ok: false, error: "Invalid order_total_ngn." }, 400);
  }

  const grossRaw = Number(body.gross_total_ngn);
  const grossTotal =
    Number.isFinite(grossRaw) && grossRaw > 0 && grossRaw <= MAX_ORDER_NGN ? grossRaw : null;

  // Accept a supplied ISO timestamp, but fall back to server time if it's
  // missing or unparseable — the browser clock isn't trustworthy.
  let timestamp = new Date().toISOString();
  if (typeof body.timestamp === "string") {
    const parsed = new Date(body.timestamp);
    if (!Number.isNaN(parsed.getTime())) timestamp = parsed.toISOString();
  }

  const commission = Math.round(orderTotal * COMMISSION_RATE * 100) / 100;

  const record = {
    ref_code: refCode,
    tx_ref: txRef,
    order_total_ngn: orderTotal,
    gross_total_ngn: grossTotal,
    commission_ngn: commission,
    commission_rate: COMMISSION_RATE,
    timestamp,
    logged_at: new Date().toISOString()
  };

  const key = `referral:${refCode}:${txRef}`;

  try {
    await env.REFERRALS_KV.put(key, JSON.stringify(record), {
      // Short keys — KV caps metadata at 1024 bytes.
      metadata: { c: refCode, t: orderTotal, m: commission, ts: timestamp }
    });
  } catch (err) {
    return json({ ok: false, error: "Could not write the referral record." }, 500);
  }

  return json({ ok: true, key, commission_ngn: commission });
}
