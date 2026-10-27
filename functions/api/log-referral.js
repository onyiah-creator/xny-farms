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
 *                            excluding delivery, as the BROWSER computed it.
 *   tx_ref           string  Flutterwave transaction reference
 *   pricing_version  integer the pricing version the order was priced with   (new)
 *   items            [{ id, qty }]  what was bought                          (new)
 *   timestamp        string  ISO 8601 (optional; defaults to now)
 *   gross_total_ngn  number  optional, subtotal + delivery, for reconciliation
 *
 * ── Commission is recorded against the price in force when the order was placed ──
 * When pricing_version and items are sent, the server loads that IMMUTABLE pricing snapshot
 * (see _lib/pricing.js), computes the commissionable subtotal itself from the snapshot's
 * prices x qty, and charges commission = the snapshot's commission_rate x that subtotal. The
 * record stores pricing_version, items, commission_rate and commission_ngn, and nothing ever
 * recomputes it later from the current rate or prices. If the browser's order_total_ngn
 * differs from the server's subtotal by more than N1 the SERVER amount is credited and the
 * record is flagged price_mismatch:true. If pricing_version/items are missing or unusable
 * (an old cached copy of the site, an unknown version, a version replaced more than 24 hours
 * ago) it falls back to the old behaviour (browser subtotal x the commission rate in force
 * now) and the record is flagged legacy:true.
 *
 * Only codes that have been APPROVED (an "affiliate:{CODE}" key exists,
 * written by register-affiliate.js) are recorded. An unrecognised code is
 * ignored silently — the response is still 200, because the caller is a
 * customer's browser mid-checkout and must never see a failure.
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

import math from "../../js/pricing-math.js";
import { loadCurrent, getSnapshot, supersededAt, LEGACY_COMMISSION_RATE } from "../_lib/pricing.js";

/** The rate used for records written before a rate was stored, and the last-resort default. */
export const COMMISSION_RATE = LEGACY_COMMISSION_RATE;

const MISMATCH_TOLERANCE_NGN = 1;            // browser vs server subtotal
const VERSION_GRACE_MS = 24 * 60 * 60 * 1000; // an old version is honoured this long after it was replaced
const MAX_ITEM_LINES = 20;
const MAX_QTY = 1000;

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

  const rawRefCode = typeof body.ref_code === "string" ? body.ref_code.trim() : "";
  if (!REF_CODE_PATTERN.test(rawRefCode)) {
    return json({ ok: false, error: "Invalid ref_code." }, 400);
  }
  // Normalised to uppercase to match how codes are stored at approval, so
  // ?ref=adebayo01 and ?ref=ADEBAYO01 credit the same affiliate.
  const refCode = rawRefCode.toUpperCase();

  /* Only APPROVED affiliates earn commission. Without this check any
     invented ?ref=WHATEVER would create a commission-earning record.
     An unrecognised code is quietly ignored: this responds 200 with
     logged:false rather than an error, because the caller is the
     customer's browser mid-checkout — nothing here should ever surface
     to them or look like a failed purchase. */
  let approved;
  try {
    approved = await env.REFERRALS_KV.get(`affiliate:${refCode}`);
  } catch (err) {
    return json({ ok: false, error: "Could not verify the referral code." }, 500);
  }
  if (!approved) {
    return json({ ok: true, logged: false, reason: "unrecognised referral code" });
  }

  /* A suspended affiliate's code stops earning. A record with no status (everything
     approved before suspension existed) is active, so existing affiliates keep working. */
  try {
    const record = JSON.parse(approved);
    if (record && record.status === "suspended") {
      return json({ ok: true, logged: false, reason: "inactive referral code" });
    }
  } catch (err) { /* an unparseable record is treated as active, as before */ }

  const txRef = typeof body.tx_ref === "string" ? body.tx_ref.trim() : "";
  if (!TX_REF_PATTERN.test(txRef)) {
    return json({ ok: false, error: "Invalid tx_ref." }, 400);
  }

  const browserTotal = Number(body.order_total_ngn);
  const browserTotalOk = Number.isFinite(browserTotal) && browserTotal > 0 && browserTotal <= MAX_ORDER_NGN;

  // Price the order from the immutable snapshot the customer was shown, if we can.
  let priced = null;
  try {
    priced = await priceFromSnapshot(env.REFERRALS_KV, body);
  } catch (err) {
    priced = null;   // a pricing read problem means the legacy path, never a failed checkout
  }

  let orderTotal;
  let rate;
  let flags = {};
  if (priced) {
    orderTotal = priced.subtotal;
    rate = priced.snapshot.commission_rate;
    flags.pricing_version = priced.snapshot.version;
    flags.items = priced.items;
    if (browserTotalOk && Math.abs(browserTotal - priced.subtotal) > MISMATCH_TOLERANCE_NGN) {
      flags.price_mismatch = true;
      flags.browser_order_total_ngn = browserTotal;
    }
  } else {
    if (!browserTotalOk) return json({ ok: false, error: "Invalid order_total_ngn." }, 400);
    orderTotal = browserTotal;
    rate = LEGACY_COMMISSION_RATE;
    try { rate = (await loadCurrent(env.REFERRALS_KV)).config.commission_rate; } catch (err) { /* keep the default */ }
    flags.legacy = true;
    flags.pricing_version = null;
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

  const commission = math.breakdown(orderTotal, { r: rate, f: 0 }).commission;

  const record = {
    ref_code: refCode,
    tx_ref: txRef,
    order_total_ngn: orderTotal,
    gross_total_ngn: grossTotal,
    commission_ngn: commission,
    commission_rate: rate,
    ...flags,
    timestamp,
    logged_at: new Date().toISOString()
  };

  const key = `referral:${refCode}:${txRef}`;

  try {
    await env.REFERRALS_KV.put(key, JSON.stringify(record), {
      // Short keys — KV caps metadata at 1024 bytes.
      // pm = price mismatch, lg = legacy (priced without a pricing version), v = pricing version, r = rate
      metadata: {
        c: refCode, t: orderTotal, m: commission, ts: timestamp, r: rate,
        ...(flags.pricing_version ? { v: flags.pricing_version } : {}),
        ...(flags.price_mismatch ? { pm: 1 } : {}),
        ...(flags.legacy ? { lg: 1 } : {})
      }
    });
  } catch (err) {
    return json({ ok: false, error: "Could not write the referral record." }, 500);
  }

  return json({ ok: true, logged: true, key, commission_ngn: commission, pricing_version: flags.pricing_version, price_mismatch: flags.price_mismatch === true, legacy: flags.legacy === true });
}

/**
 * Loads the snapshot named by the request and prices the items from it.
 * Returns { snapshot, items, subtotal } or null (-> the legacy path) when anything is missing,
 * unknown, malformed or too old.
 */
async function priceFromSnapshot(kv, body) {
  if (!Number.isInteger(body.pricing_version) || !Array.isArray(body.items)) return null;
  if (body.items.length < 1 || body.items.length > MAX_ITEM_LINES) return null;

  const snapshot = await getSnapshot(kv, body.pricing_version);
  if (!snapshot) return null;

  // A version is honoured for 24 hours after it stops being current, so a customer part-way
  // through checkout when prices change is still priced as they were shown. Much older than
  // that is not a real checkout.
  const replacedAt = await supersededAt(kv, snapshot.version);
  if (replacedAt && Date.now() - Date.parse(replacedAt) > VERSION_GRACE_MS) return null;

  const merged = new Map();
  for (const line of body.items) {
    if (!line || typeof line.id !== "string" || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY) return null;
    if (!snapshot.products[line.id]) return null;
    merged.set(line.id, (merged.get(line.id) || 0) + line.qty);
  }
  let subtotalKobo = 0;
  const items = [];
  for (const [id, qty] of merged) {
    const price = snapshot.products[id].price_ngn;
    subtotalKobo += Math.round(price * 100) * qty;
    items.push({ id, qty, price_ngn: price });
  }
  const subtotal = subtotalKobo / 100;
  if (!(subtotal > 0) || subtotal > MAX_ORDER_NGN) return null;
  return { snapshot, items, subtotal };
}
