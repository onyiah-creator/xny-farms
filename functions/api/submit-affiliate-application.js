/**
 * POST /api/submit-affiliate-application — Cloudflare Pages Function
 *
 * Public self-service affiliate signup. There is no admin step: the person
 * confirms their email, and confirming creates the affiliate (see
 * verify-affiliate.js).
 *
 * Request body (JSON): name, email, phone, bank_name, account_number,
 * account_holder, promotion_plan (optional), consent (must be true),
 * turnstile_token (when Turnstile is configured), website (honeypot: must be empty).
 *
 * What happens, in this order, and nothing is stored or emailed until the
 * checks before it have passed:
 *   1. honeypot filled        -> a bot: answered as a success, nothing sent or stored
 *   2. attempt rate limit     -> 429
 *   3. field validation       -> 400 with { field, error }
 *   4. Turnstile (if set up)  -> 400 / 503
 *   5. duplicate detection    -> 409. Email and phone are normalised (+tags, gmail dots,
 *      0803/+234 803/234803 forms) and looked up in the idx:email:/idx:phone: index.
 *        - owned by a CONFIRMED affiliate: "This email is already registered" etc.
 *        - owned by an UNCONFIRMED signup still inside its 48h window: no second signup is
 *          made; the answer says a confirmation email was already sent (status
 *          "pending_confirmation") and the page offers /api/resend-confirmation
 *   6. signup rate limit (per IP) and confirmation-email limit (per email)  -> 429
 *   7. claim the idx keys, read them back (race note in _lib/signup.js)
 *   8. store the UNCONFIRMED signup (status "unconfirmed", expirationTtl 48h) + verify:{token}
 *   9. email the confirmation link. If that fails, everything above is rolled back so the
 *      person can simply try again.
 *
 * Stored as application:{server ISO timestamp}-{short id}. The record carries bank details,
 * so an unconfirmed one deletes itself after 48 hours (NDPR: unconfirmed personal data is
 * not kept). The recipient of the confirmation email is the address on the signup record;
 * no endpoint takes a recipient from the browser.
 */
import {
  normaliseEmail, normalisePhoneIntl, randomToken, shortId, nowIso, nowMs, rateLimit, CLIENT_IP
} from "../_lib/identity.js";
import { verifyTurnstile } from "../_lib/turnstile.js";
import {
  SIGNUP_TTL_SEC, VERIFY_PREFIX, findDuplicate, claimSignupIndexes, releaseSignupIndexes, sendConfirmation
} from "../_lib/signup.js";

const LIMITS = { name: 100, bank: 80, holder: 100, plan: 1000, phoneRaw: 32 };
export const RATE = {
  attemptsPerHour: 30,        // every request that gets past the honeypot (bounds work and Turnstile calls)
  signupsPerHour: 5,          // confirmation emails triggered per IP
  confirmationsPerEmailPerDay: 3   // sends (first + resends) per normalised email
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

const clean = (value, max) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

const fail = (field, error) => json({ ok: false, field, error }, 400);

export function duplicateResponse(dup) {
  if (dup.kind === "confirmed") {
    const both = dup.fields.length === 2;
    const what = both ? "This email and phone number are" : dup.fields[0] === "email" ? "This email is" : "This phone number is";
    return json({
      ok: false,
      status: "already_registered",
      field: dup.fields[0],
      fields: dup.fields,
      resend_welcome: true,
      error: `${what} already registered. If you are that affiliate, use "Resend my welcome email" to get your details again.`
    }, 409);
  }
  return json({
    ok: false,
    status: "pending_confirmation",
    field: dup.field,
    can_resend: true,
    error: "We already sent a confirmation email for this signup. Check your inbox (and spam folder) and tap the button in it. You can ask us to send it again."
  }, 409);
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
  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: "Signup is temporarily unavailable. Please email xnyfarms@gmail.com." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: "Body must be valid JSON." }, 400);
  }
  if (!body || typeof body !== "object") return json({ ok: false, error: "Body must be a JSON object." }, 400);
  const kv = env.REFERRALS_KV;

  // 1. Honeypot. A field real people never see; bots fill every field. Answer exactly like a
  //    success so there is nothing to learn from, and do nothing.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return json({ ok: true, status: "check_email" });
  }

  const ip = CLIENT_IP(request);

  // 2. Attempt limit, before any real work.
  const attempts = await rateLimit(kv, `rl:att:${ip}`, RATE.attemptsPerHour, 3600);
  if (!attempts.allowed) {
    return json({ ok: false, status: "rate_limited", error: "Too many attempts from your connection. Please try again in a while.", retry_after_sec: attempts.retryAfterSec }, 429);
  }

  // 3. Validation.
  const name = clean(body.name, LIMITS.name);
  if (name.length < 2 || !/\p{L}/u.test(name)) return fail("name", "Please enter your full name.");
  const emailRaw = clean(body.email, 254);
  const emailNorm = normaliseEmail(emailRaw);
  if (!emailNorm) return fail("email", "Please enter a valid email address.");
  const phoneResult = normalisePhoneIntl(typeof body.phone === "string" ? body.phone.slice(0, LIMITS.phoneRaw + 1) : "");
  if (!phoneResult.ok) return fail("phone", phoneResult.error);
  const bankName = clean(body.bank_name, LIMITS.bank);
  if (bankName.length < 2) return fail("bank_name", "Please enter your bank name.");
  const account = clean(body.account_number, 40).replace(/[\s-]/g, "");
  if (!/^[A-Za-z0-9]{6,34}$/.test(account)) return fail("account_number", "Please enter your bank account number (letters and digits only).");
  const holder = clean(body.account_holder, LIMITS.holder);
  if (holder.length < 2) return fail("account_holder", "Please enter the name on the bank account.");
  const plan = clean(body.promotion_plan, LIMITS.plan);
  if (body.consent !== true) return fail("consent", "Please tick the box to agree before continuing.");

  // 4. Turnstile (skipped when not configured).
  const human = await verifyTurnstile(env, body.turnstile_token, ip);
  if (!human.ok) {
    if (human.reason === "unreachable") {
      return json({ ok: false, field: "turnstile", error: "We couldn't run the security check just now. Please try again in a moment." }, 503);
    }
    return json({ ok: false, field: "turnstile", error: "Please complete the security check and try again." }, 400);
  }

  // 5. Duplicates.
  const dup = await findDuplicate(kv, emailNorm, phoneResult.phone, null);
  if (dup) return duplicateResponse(dup);

  // 6. Limits on what actually sends mail.
  const signups = await rateLimit(kv, `rl:sign:${ip}`, RATE.signupsPerHour, 3600);
  if (!signups.allowed) {
    return json({ ok: false, status: "rate_limited", error: "Too many signups from your connection. Please try again in a while.", retry_after_sec: signups.retryAfterSec }, 429);
  }
  const perEmail = await rateLimit(kv, `rl:confirm:${emailNorm}`, RATE.confirmationsPerEmailPerDay, 86400);
  if (!perEmail.allowed) {
    return json({ ok: false, status: "rate_limited", error: "We have already sent several confirmation emails to this address today. Please check your inbox and spam folder, or try again tomorrow.", retry_after_sec: perEmail.retryAfterSec }, 429);
  }

  // 7. Claim the index keys, then read them back to confirm they are ours.
  const receivedAt = nowIso();
  const signupId = `${receivedAt}-${shortId()}`;
  let claimed = false;
  try {
    claimed = await claimSignupIndexes(kv, signupId, emailNorm, phoneResult.phone);
  } catch (err) {
    return json({ ok: false, error: "Could not save your signup. Please try again." }, 500);
  }
  if (!claimed) {
    // Somebody else's signup took one of the keys between our check and our write.
    await releaseSignupIndexes(kv, signupId, emailNorm, phoneResult.phone);
    const winner = await findDuplicate(kv, emailNorm, phoneResult.phone, signupId);
    if (winner) return duplicateResponse(winner);
    return json({ ok: false, error: "Could not save your signup. Please try again." }, 409);
  }

  // 8. The unconfirmed signup and its token, all with the same 48-hour life.
  const token = randomToken();
  const expiresAt = new Date(nowMs() + SIGNUP_TTL_SEC * 1000).toISOString();
  const record = {
    name,
    email: emailRaw,
    email_normalised: emailNorm,
    phone: clean(body.phone, LIMITS.phoneRaw),
    phone_normalised: phoneResult.phone,
    bank_name: bankName,
    account_number: account,
    account_holder: holder,
    promotion_plan: plan,
    submitted_at: receivedAt,
    received_at: receivedAt,
    consent_at: receivedAt,
    status: "unconfirmed",
    source: "self-signup",
    verify_token: token,
    expires_at: expiresAt,
    last_confirmation_at: receivedAt,
    confirmation_count: 1
  };
  const applicationKey = `application:${signupId}`;
  try {
    await kv.put(applicationKey, JSON.stringify(record), {
      expirationTtl: SIGNUP_TTL_SEC,
      metadata: { s: "unconfirmed", n: name.slice(0, 80), at: receivedAt }
    });
    await kv.put(VERIFY_PREFIX + token, JSON.stringify({ signup_id: signupId, created_at: receivedAt }), { expirationTtl: SIGNUP_TTL_SEC });
  } catch (err) {
    await rollback();
    return json({ ok: false, error: "Could not save your signup. Please try again." }, 500);
  }

  // 9. Email the confirmation link. If it can't be sent, undo everything so a retry starts clean.
  let sent;
  try {
    sent = await sendConfirmation(env, record);
  } catch (err) {
    sent = { ok: false };
  }
  if (!sent.ok) {
    await rollback();
    return json({ ok: false, error: "We couldn't send the confirmation email just now. Please try again in a few minutes." }, 502);
  }

  return json({ ok: true, status: "check_email" });

  async function rollback() {
    try {
      await kv.delete(applicationKey);
      await kv.delete(VERIFY_PREFIX + token);
      await releaseSignupIndexes(kv, signupId, emailNorm, phoneResult.phone);
    } catch (err) { /* the 48h TTL cleans up whatever this misses */ }
  }
}
