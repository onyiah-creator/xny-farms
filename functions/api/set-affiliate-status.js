/**
 * POST /api/set-affiliate-status — Cloudflare Pages Function
 *
 * Password-gated. Suspends or reactivates an affiliate.
 * Body: { password, code, status: "suspended" | "active" }
 *
 * A suspended affiliate's code stops earning (log-referral.js only credits active
 * affiliates; a record with no status counts as active) and my-stats.html shows a
 * neutral "account paused" message. Nothing is deleted: orders, payments and the
 * balance still appear in the referral report with a "suspended" badge, so commission
 * that is owed is never hidden.
 * -> { ok: true, code, status, changed }
 */
import { getJson } from "../_lib/payouts.js";
import { affiliateMetadata } from "../_lib/signup.js";
import { nowIso } from "../_lib/identity.js";

const CODE_PATTERN = /^[A-Za-z0-9]{3,32}$/;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
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
  if (!env.ADMIN_REPORT_PASSWORD) return json({ ok: false, error: "ADMIN_REPORT_PASSWORD is not set. Add it to this Pages project under Settings → Environment variables, then redeploy." }, 503);
  if (!env.REFERRALS_KV) return json({ ok: false, error: "REFERRALS_KV is not bound. Create a KV namespace named REFERRALS_KV and bind it to this Pages project under Settings → Functions → KV namespace bindings." }, 503);

  let body;
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Body must be valid JSON." }, 400); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "Body must be a JSON object." }, 400);
  if (!timingSafeEqual(typeof body.password === "string" ? body.password : "", env.ADMIN_REPORT_PASSWORD)) {
    return json({ ok: false, error: "Incorrect password." }, 401);
  }

  const rawCode = typeof body.code === "string" ? body.code.trim() : "";
  if (!CODE_PATTERN.test(rawCode)) return json({ ok: false, error: "Invalid code." }, 400);
  const code = rawCode.toUpperCase();
  if (body.status !== "suspended" && body.status !== "active") {
    return json({ ok: false, error: 'status must be "suspended" or "active".' }, 400);
  }

  let record;
  try { record = await getJson(env.REFERRALS_KV, `affiliate:${code}`); } catch (err) { return json({ ok: false, error: "Could not look up that affiliate." }, 500); }
  if (!record) return json({ ok: false, error: `No affiliate has the code ${code}.` }, 404);

  const current = record.status === "suspended" ? "suspended" : "active";
  const changed = current !== body.status;
  record.status = body.status;
  if (changed) {
    if (body.status === "suspended") record.suspended_at = nowIso(); else record.reactivated_at = nowIso();
  }
  // Written even when nothing changed: it re-syncs the KV metadata (what the listings read) with the record.
  try {
    await env.REFERRALS_KV.put(`affiliate:${code}`, JSON.stringify(record), { metadata: affiliateMetadata(record) });
  } catch (err) {
    return json({ ok: false, error: "Could not update the affiliate." }, 500);
  }
  return json({ ok: true, code, status: body.status, changed });
}
