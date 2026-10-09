/**
 * POST /api/register-affiliate — Cloudflare Pages Function
 *
 * Assigns a referral code to an approved affiliate. Used by
 * admin-approve-affiliate.html; gated by the same ADMIN_REPORT_PASSWORD
 * as the referral report.
 *
 * Request body (JSON):
 *   password    string  ADMIN_REPORT_PASSWORD
 *   code        string  the code to assign (letters/digits only)
 *   name        string  affiliate's name      (not needed when check_only)
 *   email       string  affiliate's email     (not needed when check_only)
 *   check_only  bool    optional — report availability without writing
 *
 * Stores: key "affiliate:{CODE}", value {name, email, approved_at, application_key?}.
 * application_key (only when supplied, and only if it starts with "application:")
 * links the affiliate to the application that holds their payout details.
 *
 * Codes are normalised to UPPERCASE here, in log-referral.js and in
 * get-my-stats.js, so a link typed as ?ref=adebayo01 credits the same
 * affiliate as ?ref=ADEBAYO01. Without that, a miscased link would
 * silently earn nobody anything.
 *
 * Note on uniqueness: KV is eventually consistent, so the "is this code
 * free?" read can in principle miss a write made moments earlier
 * elsewhere. With a single admin assigning codes by hand that window is
 * not a practical concern, but it is why this is a check rather than a
 * guarantee.
 */

const CODE_PATTERN = /^[A-Za-z0-9]{3,32}$/; // alphanumeric, no spaces
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

  const rawCode = typeof body.code === "string" ? body.code.trim() : "";
  if (!CODE_PATTERN.test(rawCode)) {
    return json({
      ok: false,
      error: "Code must be 3–32 characters, letters and digits only (no spaces or symbols)."
    }, 400);
  }
  const code = rawCode.toUpperCase();

  // Is it already assigned?
  let existingRaw;
  try {
    existingRaw = await env.REFERRALS_KV.get(`affiliate:${code}`);
  } catch (err) {
    return json({ ok: false, error: "Could not check the code." }, 500);
  }

  if (existingRaw) {
    let holder = "another affiliate";
    try {
      const existing = JSON.parse(existingRaw);
      if (existing && existing.name) holder = existing.name;
    } catch (err) { /* fall back to the generic label */ }
    return json({
      ok: false,
      available: false,
      code,
      error: `Code ${code} is already assigned to ${holder}. Choose a different one.`
    }, 409);
  }

  // Availability probe — report and stop, write nothing.
  if (body.check_only === true) {
    return json({ ok: true, available: true, code });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!name) return json({ ok: false, error: "Affiliate name is required." }, 400);
  if (!EMAIL_PATTERN.test(email)) {
    return json({ ok: false, error: "A valid affiliate email is required." }, 400);
  }

  /* The application this approval came from. Its key is stored on the
     affiliate record so the admin report can find the affiliate's payout
     details (bank, phone) later. The key arrives from the browser, so it is
     checked against the "application:" prefix before being used for anything:
     without that guard a crafted request could point it, or the write below,
     at any key in the namespace — an affiliate record or a referral sale
     included. */
  const applicationKey = typeof body.application_key === "string" ? body.application_key.trim() : "";
  const validApplicationKey =
    applicationKey.startsWith("application:") && applicationKey.length <= 200 ? applicationKey : "";

  const record = { name, email, approved_at: new Date().toISOString() };
  if (validApplicationKey) record.application_key = validApplicationKey;

  try {
    await env.REFERRALS_KV.put(`affiliate:${code}`, JSON.stringify(record), {
      metadata: validApplicationKey
        ? { n: name, e: email, at: record.approved_at, k: validApplicationKey }
        : { n: name, e: email, at: record.approved_at }
    });
  } catch (err) {
    return json({ ok: false, error: "Could not save the affiliate record." }, 500);
  }

  /* If this approval came from a pending application, mark that
     application approved so it drops off the pending list and can't be
     approved a second time by mistake.

     A failure here is deliberately not fatal. The affiliate record above
     is already saved and is the thing that matters; the worst case is a
     stale row in the pending list, which is better than reporting the
     whole approval as failed and inviting a duplicate attempt. */
  let applicationUpdated = false;
  if (validApplicationKey) {
    try {
      const raw = await env.REFERRALS_KV.get(validApplicationKey);
      if (raw) {
        const application = JSON.parse(raw);
        application.status = "approved";
        application.approved_code = code;
        application.approved_at = record.approved_at;
        await env.REFERRALS_KV.put(validApplicationKey, JSON.stringify(application), {
          metadata: { s: "approved", n: String(application.name || "").slice(0, 80), at: record.approved_at }
        });
        applicationUpdated = true;
      }
    } catch (err) {
      applicationUpdated = false;
    }
  }

  return json({
    ok: true,
    code,
    name,
    email,
    approved_at: record.approved_at,
    application_updated: applicationUpdated
  });
}
