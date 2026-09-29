/**
 * POST /api/submit-affiliate-application — Cloudflare Pages Function
 *
 * Saves an affiliate application from the public signup form so the
 * approval page can list pending applicants. The form ALSO opens a
 * mailto: notification; this endpoint is the durable record behind it.
 *
 * Request body (JSON): name, email, phone, bank_name, account_number,
 * account_holder, promotion_plan, submitted_at.
 *
 * Stored as: application:{server ISO timestamp}-{short random id}
 * The ISO timestamp leads the key so lexicographic KV ordering is also
 * chronological ordering; the random suffix keeps two applications
 * submitted in the same millisecond from overwriting each other. The
 * SERVER clock is used for the key — a browser's clock can be wrong or
 * deliberately set, which would put entries in the wrong order.
 *
 * Status starts as "pending"; register-affiliate.js flips it to
 * "approved" when a code is assigned. Status is mirrored into KV
 * metadata so the pending list can filter from a list() call and only
 * fetch the applications it actually needs to show.
 *
 * ── PLEASE READ: this endpoint is public and holds personal data ──
 * It takes no password (the applicant isn't logged in) and it stores
 * bank details. Two consequences worth knowing:
 *
 *  1. Anyone who finds the URL can POST junk applications. There is no
 *     captcha or rate limiting here — the field validation and size caps
 *     below only bound how much junk a single request can store. If the
 *     pending list ever fills with spam, that is the gap to close
 *     (Cloudflare Turnstile is the natural fit).
 *  2. Account numbers now sit at rest in KV, not just in your inbox.
 *     Under the NDPR that is personal data you are responsible for:
 *     keep it only as long as you need it, and delete applications you
 *     have finished with.
 */

const MAX_FIELD = 300;       // generous for names, emails, bank fields
const MAX_PLAN = 2000;       // the free-text promotion plan
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function shortId() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;

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

  const name = clean(body.name, MAX_FIELD);
  const email = clean(body.email, MAX_FIELD);
  const phone = clean(body.phone, MAX_FIELD);
  const bankName = clean(body.bank_name, MAX_FIELD);
  const accountNumber = clean(body.account_number, MAX_FIELD);
  const accountHolder = clean(body.account_holder, MAX_FIELD);
  const promotionPlan = clean(body.promotion_plan, MAX_PLAN);

  if (!name) return json({ ok: false, error: "Name is required." }, 400);
  if (!EMAIL_PATTERN.test(email)) return json({ ok: false, error: "A valid email is required." }, 400);
  if (!phone) return json({ ok: false, error: "Phone is required." }, 400);

  // Applicant-supplied timestamp is kept for reference only; the key and
  // the authoritative received_at both use server time.
  const receivedAt = new Date().toISOString();
  let submittedAt = receivedAt;
  if (typeof body.submitted_at === "string") {
    const parsed = new Date(body.submitted_at);
    if (!Number.isNaN(parsed.getTime())) submittedAt = parsed.toISOString();
  }

  const record = {
    name,
    email,
    phone,
    bank_name: bankName,
    account_number: accountNumber,
    account_holder: accountHolder,
    promotion_plan: promotionPlan,
    submitted_at: submittedAt,
    received_at: receivedAt,
    status: "pending"
  };

  const key = `application:${receivedAt}-${shortId()}`;

  try {
    await env.REFERRALS_KV.put(key, JSON.stringify(record), {
      metadata: { s: "pending", n: name.slice(0, 80), at: receivedAt }
    });
  } catch (err) {
    return json({ ok: false, error: "Could not save the application." }, 500);
  }

  return json({ ok: true, key });
}
