/**
 * GET /api/verify-affiliate?token=… — Cloudflare Pages Function
 *
 * The link in the "confirm your email" message. On the FIRST valid visit it creates the
 * affiliate for real (see confirmSignup in _lib/signup.js): unique code, affiliate:{CODE}
 * record, permanent application and idx keys, the standard welcome email and a notice to
 * the XNY Farms inbox. Every later visit (mail scanners prefetch links; people click twice)
 * is idempotent: nothing is created or sent again and the same result is shown.
 *
 * Always answers with a redirect to /affiliate-confirmed.html?status=ok&code=CODE, or
 * ?status=expired (unknown / expired token) or ?status=invalid (malformed token).
 * The token is the only input; there is no way to supply a recipient.
 */
import { confirmSignup } from "../_lib/signup.js";

function redirect(request, params) {
  const url = new URL("/affiliate-confirmed.html", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.REFERRALS_KV) return redirect(request, { status: "invalid" });
  const token = new URL(request.url).searchParams.get("token") || "";
  let result;
  try {
    result = await confirmSignup(env, token);
  } catch (err) {
    return redirect(request, { status: "error" });
  }
  return result.status === "ok"
    ? redirect(request, { status: "ok", code: result.code })
    : redirect(request, { status: result.status });
}
