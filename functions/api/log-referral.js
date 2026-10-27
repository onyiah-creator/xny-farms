/**
 * POST /api/log-referral — Cloudflare Pages Function. Public. LEGACY ENDPOINT.
 *
 * This used to record whatever sale the browser reported, which meant anyone could invent
 * sales (and so commission). It no longer records anything the browser says. Commission is now
 * credited only by the server, when a payment has been verified with Flutterwave
 * (see _lib/orders.js and _lib/referrals.js), at the price and rate fixed when the order was created.
 *
 * It remains only so that a copy of the checkout page cached before this change doesn't error:
 * given a tx_ref that belongs to a PAID, VERIFIED order it (idempotently) makes sure that order's
 * commission has been recorded; for anything else it answers 200 { logged: false } and writes
 * nothing. The ref_code, amounts, items and version in the request are ignored.
 */
import { getJson } from "../_lib/payouts.js";
import { orderKey, validTxRef } from "../_lib/orders.js";
import { recordReferralForOrder } from "../_lib/referrals.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.REFERRALS_KV) return json({ ok: false, error: "Unavailable." }, 503);

  let body;
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Body must be valid JSON." }, 400); }
  const txRef = body && body.tx_ref;
  if (!validTxRef(txRef)) return json({ ok: true, logged: false, reason: "not a verified order" });

  const order = await getJson(env.REFERRALS_KV, orderKey(txRef));
  if (!order || order.status !== "paid") return json({ ok: true, logged: false, reason: "order is not verified as paid" });

  const result = await recordReferralForOrder(env.REFERRALS_KV, order);
  return json({ ok: true, logged: result.logged, reason: result.logged ? undefined : result.reason });
}
