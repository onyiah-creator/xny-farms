/**
 * Writes a referral (commission) record for a PAID, VERIFIED order.
 *
 * This is the only place a sale is ever credited to an affiliate. It is called by order
 * settlement (_lib/orders.js) after Flutterwave has confirmed the payment server-side, and
 * reads everything from the stored order, whose prices and commission rate were fixed by
 * the server when the order was created. Nothing here comes from a browser request, so a
 * fabricated or tampered sale can't earn commission.
 *
 * Rules: the affiliate must exist and be active; a sale where the buyer's email or phone is the
 * affiliate's own is not credited (an affiliate buying through their own link).
 *
 * Record: referral:{CODE}:{tx_ref} (idempotent: the same order always writes the same key),
 * metadata { c, t, m, ts, r, v } so reports can total from list() alone.
 *
 * Lives in functions/_lib/ and exports no onRequest* handler, so Pages does not route it.
 */
import math from "../../js/pricing-math.js";
import { getJson } from "./payouts.js";
import { normaliseEmail, normalisePhoneIntl } from "./identity.js";

/** Returns { logged: true, record } or { logged: false, reason }. */
export async function recordReferralForOrder(kv, order) {
  const code = String(order.ref_code || "").toUpperCase();
  if (!code) return { logged: false, reason: "no referral code" };

  const affiliate = await getJson(kv, `affiliate:${code}`);
  if (!affiliate) return { logged: false, reason: "unrecognised referral code" };
  if (affiliate.status === "suspended") return { logged: false, reason: "inactive referral code" };

  const buyerEmail = normaliseEmail(order.customer && order.customer.email);
  const affEmail = normaliseEmail(affiliate.email);
  const buyerPhone = normalisePhoneIntl(order.customer && order.customer.phone);
  if ((buyerEmail && affEmail && buyerEmail === affEmail) ||
      (buyerPhone.ok && affiliate.phone && buyerPhone.phone === String(affiliate.phone))) {
    return { logged: false, reason: "self-referral" };
  }

  const rate = order.commission_rate;
  const commission = math.breakdown(order.subtotal_ngn, { r: rate, f: 0 }).commission;
  const record = {
    ref_code: code,
    tx_ref: order.tx_ref,
    order_total_ngn: order.subtotal_ngn,
    gross_total_ngn: order.total_ngn,
    commission_ngn: commission,
    commission_rate: rate,
    pricing_version: order.pricing_version,
    items: order.items,
    verified: true,
    timestamp: order.paid_at,
    logged_at: new Date(Date.now()).toISOString()
  };
  await kv.put(`referral:${code}:${order.tx_ref}`, JSON.stringify(record), {
    metadata: { c: code, t: order.subtotal_ngn, m: commission, ts: order.paid_at, r: rate, v: order.pricing_version }
  });
  return { logged: true, record };
}
