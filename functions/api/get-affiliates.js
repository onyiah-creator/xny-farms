/**
 * POST /api/get-affiliates — Cloudflare Pages Function
 *
 * Lists already-approved affiliates (name, code, email, approval date) for
 * admin-approve-affiliate.html, so the admin can resend someone's welcome
 * email. Gated by ADMIN_REPORT_PASSWORD like every other admin endpoint —
 * this returns affiliates' email addresses, so it must never be public.
 *
 * Request body (JSON): { "password": "…" }
 * Response: { ok, count, affiliates: [{ code, name, email, approved_at }] }
 *
 * Records are keyed "affiliate:{CODE}" (written by register-affiliate.js,
 * which mirrors name/email/time into KV metadata). The listing reads that
 * metadata straight from list(), so it costs one call per 1000 affiliates
 * rather than a read per affiliate; anything written without metadata falls
 * back to reading its value.
 */

const KEY_PREFIX = "affiliate:";

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

  const affiliates = [];
  let cursor;
  let listComplete = false;

  try {
    while (!listComplete) {
      const page = await env.REFERRALS_KV.list({ prefix: KEY_PREFIX, cursor, limit: 1000 });

      for (const key of page.keys) {
        const code = key.name.slice(KEY_PREFIX.length);
        if (!code) continue;

        const meta = key.metadata;
        let name;
        let email;
        let approvedAt;

        if (meta && typeof meta.e === "string") {
          name = meta.n;
          email = meta.e;
          approvedAt = meta.at;
        } else {
          const raw = await env.REFERRALS_KV.get(key.name);
          if (!raw) continue;
          try {
            const value = JSON.parse(raw);
            name = value.name;
            email = value.email;
            approvedAt = value.approved_at;
          } catch (err) {
            continue;
          }
        }

        affiliates.push({
          code,
          name: typeof name === "string" ? name : "",
          email: typeof email === "string" ? email : "",
          approved_at: typeof approvedAt === "string" ? approvedAt : null
        });
      }

      cursor = page.cursor;
      listComplete = page.list_complete === true || !page.cursor;
    }
  } catch (err) {
    return json({ ok: false, error: "Could not list affiliates." }, 500);
  }

  // Newest approval first; anything without a date sorts last.
  affiliates.sort((a, b) => (b.approved_at || "").localeCompare(a.approved_at || ""));

  return json({
    ok: true,
    count: affiliates.length,
    generated_at: new Date().toISOString(),
    affiliates
  });
}
