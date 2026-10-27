/**
 * GET /api/pricing — Cloudflare Pages Function. PUBLIC (no password).
 *
 * The prices and delivery charges the storefront, cart and checkout use, plus the
 * affiliate commission rate shown to people. Returns ONLY public fields:
 *
 *   { ok, version,
 *     products: [{ id, name, size, price_ngn }],
 *     delivery: { lagos, other },          // what the CUSTOMER is charged
 *     commission_rate }
 *
 * It never returns the processor fee, target nets, other costs or courier costs; those are
 * business-private and only /api/admin-pricing (password-gated) can read them.
 *
 * Cache-Control: public, max-age=30, so a price change reaches shoppers within about a
 * minute (browser cache 30s + KV propagation). Checkout re-fetches with no-store before paying.
 * Source: the versioned pricing config in KV (see _lib/pricing.js).
 */
import { loadCurrent, publicView } from "../_lib/pricing.js";

function json(data, status, cache) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache || "no-store" }
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.REFERRALS_KV) {
    return json({ ok: false, error: "Pricing is temporarily unavailable." }, 503);
  }
  try {
    const { config } = await loadCurrent(env.REFERRALS_KV);
    return json({ ok: true, ...publicView(config) }, 200, "public, max-age=30");
  } catch (err) {
    // An error must never be cached, and the client must treat it as "do not charge".
    return json({ ok: false, error: "Pricing is temporarily unavailable." }, 503);
  }
}
