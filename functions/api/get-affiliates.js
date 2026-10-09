/**
 * POST /api/get-affiliates — Cloudflare Pages Function
 *
 * Lists already-approved affiliates (name, code, email, approval date) for
 * admin-approve-affiliate.html, so the admin can resend someone's welcome
 * email. Gated by ADMIN_REPORT_PASSWORD like every other admin endpoint —
 * this returns affiliates' email addresses, so it must never be public.
 *
 * Request body (JSON): { "password": "…" }
 * Response: { ok, count, config: { turnstile_secret_configured, resend_configured },
 *             affiliates: [{ code, name, email, approved_at, status, source, email_verified_at }] }
 *   status: "active" | "suspended" (no stored status = active); source: "self-signup" | "admin".
 *
 * Records are keyed "affiliate:{CODE}" (written by register-affiliate.js,
 * which mirrors name/email/time into KV metadata). The listing reads that
 * metadata straight from list(), so it costs one call per 1000 affiliates
 * rather than a read per affiliate; anything written without metadata falls
 * back to reading its value.
 */

import { loadAffiliates } from "../_lib/payouts.js";
import { turnstileConfigured } from "../_lib/turnstile.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ADMIN_REPORT_PASSWORD) {
    return json({
      ok: false,
      error:
        "ADMIN_REPORT_PASSWORD is not set. Add it to this Pages project under " +
        "Settings → Environment variables, then redeploy."
    }, 503);
  }
  if (!env.REFERRALS_KV) {
    return json({
      ok: false,
      error:
        "REFERRALS_KV is not bound. Create a KV namespace named REFERRALS_KV and bind it " +
        "to this Pages project under Settings → Functions → KV namespace bindings."
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: "Body must be valid JSON." }, 400);
  }

  const supplied = typeof body.password === "string" ? body.password : "";
  if (!timingSafeEqual(supplied, env.ADMIN_REPORT_PASSWORD)) {
    return json({ ok: false, error: "Incorrect password." }, 401);
  }

  let affiliates;
  try {
    affiliates = await loadAffiliates(env.REFERRALS_KV);
  } catch (err) {
    return json({ ok: false, error: "Could not list affiliates." }, 500);
  }
  affiliates = affiliates.map((a) => ({
    code: a.code,
    name: a.name,
    email: a.email,
    approved_at: typeof a.approved_at === "string" ? a.approved_at : null,
    status: a.status === "suspended" ? "suspended" : "active",
    source: a.source === "self-signup" ? "self-signup" : "admin",
    email_verified_at: a.email_verified_at || null
  }));

  // Newest approval first; anything without a date sorts last.
  affiliates.sort((a, b) => (b.approved_at || "").localeCompare(a.approved_at || ""));

  return json({
    ok: true,
    count: affiliates.length,
    generated_at: new Date().toISOString(),
    // Shown on the admin page so a missing safeguard is a visible choice, not a silent gap.
    config: {
      turnstile_secret_configured: turnstileConfigured(env),
      resend_configured: Boolean(env.RESEND_API_KEY)
    },
    affiliates
  });
}
