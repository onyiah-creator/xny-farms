/**
 * POST /api/get-pending-applications — Cloudflare Pages Function
 *
 * Returns affiliate applications still awaiting a decision, newest
 * first, for admin-approve-affiliate.html. Gated by the same
 * ADMIN_REPORT_PASSWORD as the other admin tools — these records contain
 * applicants' bank details, so this must never be public.
 *
 * Request body (JSON): { "password": "…" }
 * Response: { ok, count, applications: [{ key, name, email, phone,
 *             bank_name, account_number, account_holder,
 *             promotion_plan, submitted_at, received_at }] }
 *
 * Status lives in KV metadata as well as in the value, so the pending
 * set can be identified from the list() call and only those records are
 * fetched — approved applications cost nothing to skip. Records written
 * without metadata fall back to being read and filtered by value.
 */

const KEY_PREFIX = "application:";
const MAX_RETURNED = 200;

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

  const candidates = [];
  let cursor;
  let listComplete = false;

  try {
    while (!listComplete) {
      const page = await env.REFERRALS_KV.list({ prefix: KEY_PREFIX, cursor, limit: 1000 });
      for (const key of page.keys) {
        const meta = key.metadata;
        // Skip anything already decided without paying for a read.
        if (meta && typeof meta.s === "string" && meta.s !== "pending") continue;
        candidates.push(key.name);
      }
      cursor = page.cursor;
      listComplete = page.list_complete === true || !page.cursor;
    }
  } catch (err) {
    return json({ ok: false, error: "Could not list applications." }, 500);
  }

  // Keys lead with an ISO timestamp, so lexicographic order is
  // chronological — reverse it for newest-first.
  candidates.sort();
  candidates.reverse();

  const applications = [];
  try {
    for (const name of candidates) {
      if (applications.length >= MAX_RETURNED) break;
      const raw = await env.REFERRALS_KV.get(name);
      if (!raw) continue;
      let value;
      try {
        value = JSON.parse(raw);
      } catch (err) {
        continue;
      }
      // Authoritative check: the value's own status wins over metadata.
      if (value.status && value.status !== "pending") continue;
      applications.push({
        key: name,
        name: value.name || "",
        email: value.email || "",
        phone: value.phone || "",
        bank_name: value.bank_name || "",
        account_number: value.account_number || "",
        account_holder: value.account_holder || "",
        promotion_plan: value.promotion_plan || "",
        submitted_at: value.submitted_at || value.received_at || null,
        received_at: value.received_at || null
      });
    }
  } catch (err) {
    return json({ ok: false, error: "Could not read applications." }, 500);
  }

  return json({
    ok: true,
    count: applications.length,
    truncated: candidates.length > applications.length,
    generated_at: new Date().toISOString(),
    applications
  });
}
