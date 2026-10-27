/**
 * POST /api/flutterwave-webhook — Cloudflare Pages Function.
 *
 * Flutterwave calls this when a charge completes, so an order is confirmed even if the customer
 * closes the tab before the browser can ask. Setup (Flutterwave dashboard -> Settings -> Webhooks):
 *   URL         https://xnyfarms.com/api/flutterwave-webhook
 *   Secret hash a long random string; put the SAME value in the Pages variable FLW_SECRET_HASH.
 *
 * The request is accepted only if its "verif-hash" header equals FLW_SECRET_HASH (constant-time
 * comparison). Even then the body is not trusted: only the tx_ref is taken from it, and the
 * payment is re-verified with Flutterwave's API before anything is marked paid.
 * Answers 200 when handled and 503 when Flutterwave couldn't be asked, so Flutterwave retries.
 */
import { settleOrder, validTxRef } from "../_lib/orders.js";
import { timingSafeEqual } from "../_lib/admin-auth.js";

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.REFERRALS_KV || !env.FLW_SECRET_HASH) return json({ ok: false, error: "Webhook is not configured." }, 503);

  const sent = request.headers.get("verif-hash") || "";
  if (!timingSafeEqual(sent, env.FLW_SECRET_HASH)) return json({ ok: false, error: "Invalid signature." }, 401);

  let body;
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Invalid body." }, 400); }
  const txRef = body && body.data && (body.data.tx_ref || body.data.txRef);
  if (!validTxRef(txRef)) return json({ ok: true, ignored: true });   // not one of our orders

  let result;
  try {
    result = await settleOrder(env, txRef, "webhook");
  } catch (err) {
    return json({ ok: false, error: "Could not process." }, 503);
  }
  return result.state === "unverified" ? json({ ok: false, state: result.state }, 503) : json({ ok: true, state: result.state });
}
