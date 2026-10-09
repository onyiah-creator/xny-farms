/**
 * POST /api/resend-welcome — Cloudflare Pages Function
 *
 * Public "Resend my welcome email". Body: { email }.
 *
 * It ALWAYS answers the same thing — "If that email is registered, we have sent your
 * details" — whether or not the address belongs to an affiliate, so it can't be used to
 * find out who is registered. If it does match an ACTIVE affiliate, the standard welcome
 * email is sent to the address on the affiliate's record (never to anything in the
 * request). The email is sent after the response (waitUntil) so how long this takes
 * doesn't give the answer away either.
 *
 * Limits: per IP and per email, so it can't be used to bother someone. A rate-limited
 * request gets a 429, which says nothing about whether the address exists.
 */
import { normaliseEmail, rateLimit, CLIENT_IP } from "../_lib/identity.js";
import { findAffiliateByEmail, sendWelcomeTo } from "../_lib/signup.js";

const MESSAGE = "If that email is registered, we have sent your details.";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.REFERRALS_KV) return json({ ok: false, error: "Service unavailable." }, 503);
  const kv = env.REFERRALS_KV;

  let body;
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Body must be valid JSON." }, 400); }
  const emailNorm = normaliseEmail(body && typeof body.email === "string" ? body.email : "");
  if (!emailNorm) return json({ ok: false, field: "email", error: "Please enter a valid email address." }, 400);

  const ip = await rateLimit(kv, `rl:rw:ip:${CLIENT_IP(request)}`, 5, 3600);
  const perEmail = await rateLimit(kv, `rl:rw:email:${emailNorm}`, 3, 86400);
  if (!ip.allowed || !perEmail.allowed) {
    return json({ ok: false, status: "rate_limited", error: "Too many requests. Please try again later." }, 429);
  }

  const work = (async () => {
    try {
      if (!env.RESEND_API_KEY) return;
      const found = await findAffiliateByEmail(kv, emailNorm);
      if (!found) return;
      const status = found.record.status || "active";
      if (status !== "active") return;
      await sendWelcomeTo(env, found.code, found.record);
    } catch (err) { /* never visible to the caller */ }
  })();
  if (typeof context.waitUntil === "function") context.waitUntil(work); else await work;

  return json({ ok: true, message: MESSAGE });
}
