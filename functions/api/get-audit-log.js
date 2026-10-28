/**
 * POST /api/get-audit-log — Cloudflare Pages Function. Password-gated (and Cloudflare Access-gated when
 * ACCESS_ENFORCE is "true"), like every admin endpoint.
 *
 * Body (JSON): { password }
 *   -> { ok, entries: [{ at, actor_email, actor_ip, action, summary }], total }
 *      newest first, at most 200. `total` is how many entries are kept (they expire after 400 days).
 *
 * See _lib/audit.js for what is recorded and, just as important, what is never put in a summary.
 */
import { adminDenied } from "../_lib/admin-auth.js";
import { readAudit, AUDIT_READ_LIMIT } from "../_lib/audit.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_REPORT_PASSWORD) return json({ ok: false, error: "ADMIN_REPORT_PASSWORD is not set. Add it to this Pages project under Settings → Environment variables, then redeploy." }, 503);
  if (!env.REFERRALS_KV) return json({ ok: false, error: "REFERRALS_KV is not bound. Create a KV namespace named REFERRALS_KV and bind it to this Pages project under Settings → Functions → KV namespace bindings." }, 503);

  let body;
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Body must be valid JSON." }, 400); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "Body must be a JSON object." }, 400);

  const auth = await adminDenied(request, env, body);
  if (auth instanceof Response) return auth;

  try {
    const { entries, total } = await readAudit(env.REFERRALS_KV, AUDIT_READ_LIMIT);
    return json({ ok: true, entries, total });
  } catch (err) {
    return json({ ok: false, error: "Could not read the activity log." }, 500);
  }
}
