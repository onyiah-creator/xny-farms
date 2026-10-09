/**
 * POST /api/resend-confirmation — Cloudflare Pages Function
 *
 * Public. Sends the "confirm your email" message again for a signup that is still waiting
 * (inside its 48-hour window). Body: { email }.
 *
 * The email goes to the address STORED on the signup record, never to anything in the
 * request: the request only identifies which pending signup is meant. Limits: at most one
 * resend per 10 minutes per signup, 3 confirmation emails per address per day, and a per-IP
 * cap. The same confirmation link is re-sent (the token is not rotated), so an earlier email
 * keeps working.
 */
import { normaliseEmail, nowIso, rateLimit, CLIENT_IP, nowMs } from "../_lib/identity.js";
import { getJson, APPLICATION_PREFIX } from "../_lib/payouts.js";
import { idxEmailKey, liveOwner, saveUnconfirmed, sendConfirmation, RESEND_COOLDOWN_SEC } from "../_lib/signup.js";
import { RATE } from "./submit-affiliate-application.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.REFERRALS_KV) return json({ ok: false, error: "REFERRALS_KV is not bound." }, 503);
  if (!env.RESEND_API_KEY) return json({ ok: false, error: "Email is temporarily unavailable. Please email xnyfarms@gmail.com." }, 503);
  const kv = env.REFERRALS_KV;

  let body;
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Body must be valid JSON." }, 400); }
  const emailNorm = normaliseEmail(body && typeof body.email === "string" ? body.email : "");
  if (!emailNorm) return json({ ok: false, field: "email", error: "Please enter a valid email address." }, 400);

  const ip = await rateLimit(kv, `rl:rc:${CLIENT_IP(request)}`, 10, 3600);
  if (!ip.allowed) return json({ ok: false, status: "rate_limited", error: "Too many requests. Please try again in a while.", retry_after_sec: ip.retryAfterSec }, 429);

  const owner = await getJson(kv, idxEmailKey(emailNorm));
  const live = await liveOwner(kv, owner);
  if (!live || live.kind !== "unconfirmed") {
    return json({
      ok: false,
      status: "not_found",
      error: "We couldn't find a signup waiting for confirmation with that email. If it was more than 48 hours ago it has expired, so please sign up again."
    }, 404);
  }

  const record = live.record;
  const sinceLast = (nowMs() - Date.parse(record.last_confirmation_at || record.received_at)) / 1000;
  if (sinceLast < RESEND_COOLDOWN_SEC) {
    const wait = Math.ceil((RESEND_COOLDOWN_SEC - sinceLast) / 60);
    return json({
      ok: false,
      status: "cooldown",
      error: `We sent the email a moment ago. Check your inbox and spam folder, or try again in ${wait} minute${wait === 1 ? "" : "s"}.`,
      retry_after_sec: Math.ceil(RESEND_COOLDOWN_SEC - sinceLast)
    }, 429);
  }
  const perEmail = await rateLimit(kv, `rl:confirm:${emailNorm}`, RATE.confirmationsPerEmailPerDay, 86400);
  if (!perEmail.allowed) {
    return json({ ok: false, status: "rate_limited", error: "We have already sent several confirmation emails to this address today. Please try again tomorrow.", retry_after_sec: perEmail.retryAfterSec }, 429);
  }

  const sent = await sendConfirmation(env, record);
  if (!sent.ok) return json({ ok: false, error: "We couldn't send the email just now. Please try again in a few minutes." }, 502);

  try {
    record.last_confirmation_at = nowIso();
    record.confirmation_count = (record.confirmation_count || 1) + 1;
    await saveUnconfirmed(kv, live.id, record);
  } catch (err) { /* the email is sent; the cooldown just won't be recorded */ }
  return json({ ok: true, status: "resent" });
}
