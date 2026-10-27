/**
 * POST /api/verify-order — Cloudflare Pages Function. Public.
 *
 * Called by the checkout page after the Flutterwave window closes. The browser's own idea of
 * whether it paid is NOT trusted: this asks Flutterwave, server to server, and only a payment of
 * at least the order total, in NGN, for that tx_ref, marks the order paid (and credits the
 * affiliate and notifies the business). Safe to call repeatedly.
 *
 * Body: { tx_ref }.  Response: { ok, state, total? } where state is one of
 *   paid | pending | failed | underpaid | unverified | unknown   (see _lib/orders.js)
 * Nothing about the customer or the cost breakdown is returned.
 */
import { settleOrder, validTxRef } from "../_lib/orders.js";
import { rateLimit, CLIENT_IP } from "../_lib/identity.js";

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
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Invalid request." }, 400); }
  if (!body || !validTxRef(body.tx_ref)) return json({ ok: false, error: "Invalid order reference." }, 400);

  const limit = await rateLimit(env.REFERRALS_KV, `rl:verify:${CLIENT_IP(request)}`, 90, 3600);
  if (!limit.allowed) return json({ ok: false, error: "Too many requests. Please try again later." }, 429);

  let result;
  try {
    result = await settleOrder(env, body.tx_ref, "browser");
  } catch (err) {
    return json({ ok: true, state: "unverified" });
  }
  const out = { ok: true, state: result.state };
  if (result.state === "paid") out.total = result.order.total_ngn;
  return json(out);
}
