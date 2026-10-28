/**
 * GET/POST /api/admin-status — Cloudflare Pages Function. Password-gated (and Cloudflare Access-gated when
 * ACCESS_ENFORCE is "true", like every admin endpoint).
 *
 * POST body { password }, or GET with the password in an X-Admin-Password header (never in the URL).
 *   -> { ok, access_enforced, access_configured, access_jwt_valid, admin_email }
 *
 * The admin pages call it after sign-in to show a banner: green "Protected by Cloudflare Access as <email>",
 * or an amber warning when Access is not enforced. admin_email is the email from a VERIFIED Access JWT, or
 * null. Nothing secret is returned: not the team domain, not the audience tag.
 */
import { adminDenied, accessConfig, PASSWORD_ONLY } from "../_lib/admin-auth.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function handle(request, env, body) {
  if (!env.ADMIN_REPORT_PASSWORD) return json({ ok: false, error: "ADMIN_REPORT_PASSWORD is not set. Add it to this Pages project under Settings → Environment variables, then redeploy." }, 503);
  if (!env.REFERRALS_KV) return json({ ok: false, error: "REFERRALS_KV is not bound. Create a KV namespace named REFERRALS_KV and bind it to this Pages project under Settings → Functions → KV namespace bindings." }, 503);

  const auth = await adminDenied(request, env, body);
  if (auth instanceof Response) return auth;

  const cfg = accessConfig(env);
  const verified = auth.email !== PASSWORD_ONLY;
  return json({
    ok: true,
    access_enforced: cfg.enforce,
    access_configured: cfg.configured,
    access_jwt_valid: verified,
    admin_email: verified ? auth.email : null
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Body must be valid JSON." }, 400); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "Body must be a JSON object." }, 400);
  return handle(request, env, body);
}

export async function onRequestGet({ request, env }) {
  return handle(request, env, { password: request.headers.get("X-Admin-Password") || "" });
}
