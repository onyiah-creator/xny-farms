/**
 * POST /api/create-order — Cloudflare Pages Function. Public (a customer is checking out).
 *
 * Creates an order on the SERVER: the cart is priced here from the pricing config in force, not
 * from anything the browser sends, and the order total is fixed in KV. The browser gets back the
 * tx_ref and the amount to charge, opens Flutterwave with exactly those, and later asks
 * /api/verify-order to confirm the payment. See _lib/orders.js for the whole flow.
 *
 * Body (JSON): { items: [{ id, qty }], fulfilment: "pickup"|"lagos"|"other",
 *                customer: { name, email, phone, address }, ref_code? }
 *   Any price, total or amount in the request is IGNORED.
 * Response: { ok, tx_ref, amount, currency, subtotal, delivery, pricing_version, items }
 *
 * It refuses (503) when FLW_SECRET_KEY isn't configured: an order that can't be verified
 * must never be taken. Limited to 20 orders per IP per hour.
 */
import { createOrder, publicOrder } from "../_lib/orders.js";
import { rateLimit, CLIENT_IP } from "../_lib/identity.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.REFERRALS_KV) return json({ ok: false, error: "Checkout is temporarily unavailable." }, 503);
  if (!env.FLW_SECRET_KEY) {
    return json({ ok: false, error: "Online payment is being set up and isn't available yet. Please contact us to place your order." }, 503);
  }

  let body;
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Invalid request." }, 400); }

  const limit = await rateLimit(env.REFERRALS_KV, `rl:order:${CLIENT_IP(request)}`, 20, 3600);
  if (!limit.allowed) return json({ ok: false, error: "Too many checkout attempts. Please try again later." }, 429);

  let result;
  try {
    result = await createOrder(env.REFERRALS_KV, body);
  } catch (err) {
    return json({ ok: false, error: "Prices are temporarily unavailable. Please try again in a moment." }, 503);
  }
  if (!result.ok) return json({ ok: false, field: result.field, error: result.error }, result.status);
  return json({ ok: true, ...publicOrder(result.order) });
}
