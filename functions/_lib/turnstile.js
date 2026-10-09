/**
 * Cloudflare Turnstile verification (optional).
 *
 * Configured only when the TURNSTILE_SECRET_KEY environment variable is set. The public
 * site key lives in the signup page (one constant). With no secret configured everything
 * here is skipped and the other protections (honeypot, rate limits) carry the load; the
 * admin page shows a warning so that is a visible choice, not a silent gap.
 *
 * Lives in functions/_lib/ and exports no onRequest* handler.
 */
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const turnstileConfigured = (env) => typeof env.TURNSTILE_SECRET_KEY === "string" && env.TURNSTILE_SECRET_KEY.length > 0;

/**
 * Returns { ok: true, skipped?: true } | { ok: false, reason: "missing" | "failed" | "unreachable" }.
 * Fails CLOSED when a secret is configured but Cloudflare can't be reached: an outage must
 * not quietly switch the protection off.
 */
export async function verifyTurnstile(env, token, ip) {
  if (!turnstileConfigured(env)) return { ok: true, skipped: true };
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, reason: "missing" };
  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  if (ip && ip !== "unknown") form.set("remoteip", ip);
  let response;
  try {
    response = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
  } catch (err) {
    return { ok: false, reason: "unreachable" };
  }
  let payload = {};
  try { payload = await response.json(); } catch (err) { return { ok: false, reason: "unreachable" }; }
  return payload && payload.success === true ? { ok: true } : { ok: false, reason: "failed" };
}
