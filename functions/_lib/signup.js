/**
 * Self-service affiliate signup: the KV side. Duplicate-detection index,
 * the unconfirmed-signup lifecycle, confirmation (which creates the affiliate)
 * and the welcome / admin emails that follow it.
 *
 * ── KV keys ──
 *   application:{ts}-{id}   the signup. status "unconfirmed" + expirationTtl 48h until the
 *                           email is confirmed, then "approved" and permanent.
 *   idx:email:{normalised}  who owns this email:  {type:"signup",id} | {type:"affiliate",code}
 *   idx:phone:{normalised}  same, for the phone number
 *   verify:{token}          {signup_id} for 48h; after use {signup_id, code, used_at} for 90 days
 *   rl:*                    rate-limit counters (see identity.js)
 *   An unconfirmed signup's application, idx keys and token all carry the same TTL, so
 *   bank details that were never confirmed are not kept.
 *
 * ── The race window (documented in the README) ──
 * KV is eventually consistent and has no compare-and-set. The idx keys are written FIRST and
 * then read back to confirm they still point at this signup; that catches two requests that
 * are separated by more than KV's propagation delay, but two requests landing at the same
 * instant in different data centres can each win their own copy. The consequence is bounded
 * (two confirmation emails for one email/phone; at confirmation the second one is then
 * recognised as a duplicate), and the Rebuild-index report lists any pair that slips through.
 *
 * Lives in functions/_lib/ and exports no onRequest* handler.
 */
import {
  getJson, listAll, AFFILIATE_PREFIX, REFERRAL_PREFIX, PAYOUT_PREFIX, APPLICATION_PREFIX
} from "./payouts.js";
import { SITE_URL, REPLY_TO, sendViaResend } from "./email.js";
import { nowIso, nowMs, randomToken, normaliseEmail, pickCode } from "./identity.js";
import { buildConfirmationEmail, buildAdminNotice } from "./signup-emails.js";
import { buildWelcomeEmail } from "../api/send-affiliate-email.js";

export const SIGNUP_TTL_SEC = 48 * 60 * 60;
export const USED_TOKEN_TTL_SEC = 90 * 24 * 60 * 60;
export const RESEND_COOLDOWN_SEC = 10 * 60;
export const IDX_EMAIL = "idx:email:";
export const IDX_PHONE = "idx:phone:";
export const VERIFY_PREFIX = "verify:";

export const idxEmailKey = (normalised) => IDX_EMAIL + normalised;
export const idxPhoneKey = (normalised) => IDX_PHONE + normalised;

/* ---- the duplicate index ---- */

async function readOwner(kv, key) {
  return getJson(kv, key);
}

/** Resolves an idx owner to what it is NOW. Stale owners (an expired signup, an affiliate record
 *  that no longer exists) count as free: an index key must never block anyone on its own. */
export async function liveOwner(kv, owner) {
  if (!owner || typeof owner !== "object") return null;
  if (owner.type === "affiliate" && owner.code) {
    const record = await getJson(kv, AFFILIATE_PREFIX + owner.code);
    return record ? { kind: "confirmed", code: owner.code, record } : null;
  }
  if (owner.type === "signup" && owner.id) {
    const app = await getJson(kv, APPLICATION_PREFIX + owner.id);
    if (!app) return null;
    if (app.status === "unconfirmed" && Date.parse(app.expires_at) > nowMs()) {
      return { kind: "unconfirmed", id: owner.id, record: app };
    }
    if (app.status === "approved" && app.approved_code) return { kind: "confirmed", code: app.approved_code };
  }
  return null;
}

/**
 * Looks both keys up. Confirmed affiliates take priority over unconfirmed signups.
 * Returns null (free) or
 *   { kind: "confirmed", fields: ["email"|"phone", ...] }
 *   { kind: "unconfirmed", field, id, record }
 * `ignoreId` skips idx keys that already belong to this signup.
 */
export async function findDuplicate(kv, emailNorm, phoneNorm, ignoreId) {
  const checks = [["email", idxEmailKey(emailNorm)], ["phone", idxPhoneKey(phoneNorm)]];
  const owners = [];
  for (const [field, key] of checks) {
    const raw = await readOwner(kv, key);
    if (raw && raw.type === "signup" && raw.id === ignoreId) continue;
    const live = await liveOwner(kv, raw);
    if (live) owners.push({ field, live });
  }
  const confirmed = owners.filter((o) => o.live.kind === "confirmed");
  if (confirmed.length) return { kind: "confirmed", fields: confirmed.map((o) => o.field) };
  if (owners.length) {
    const first = owners[0];
    return { kind: "unconfirmed", field: first.field, id: first.live.id, record: first.live.record };
  }
  return null;
}

/** Writes both idx keys for a new signup, then reads them back (see the race note above). */
export async function claimSignupIndexes(kv, signupId, emailNorm, phoneNorm) {
  const value = JSON.stringify({ type: "signup", id: signupId, at: nowIso() });
  const options = { expirationTtl: SIGNUP_TTL_SEC };
  await kv.put(idxEmailKey(emailNorm), value, options);
  await kv.put(idxPhoneKey(phoneNorm), value, options);
  const [e, p] = await Promise.all([readOwner(kv, idxEmailKey(emailNorm)), readOwner(kv, idxPhoneKey(phoneNorm))]);
  const mine = (o) => o && o.type === "signup" && o.id === signupId;
  return mine(e) && mine(p);
}

/** Deletes idx keys, but only those still pointing at this signup. */
export async function releaseSignupIndexes(kv, signupId, emailNorm, phoneNorm) {
  for (const key of [idxEmailKey(emailNorm), idxPhoneKey(phoneNorm)]) {
    const owner = await readOwner(kv, key);
    if (owner && owner.type === "signup" && owner.id === signupId) await kv.delete(key);
  }
}

/* ---- the unconfirmed signup record ---- */

/** Re-saves an unconfirmed signup WITHOUT extending its life: the TTL is whatever is left. */
export async function saveUnconfirmed(kv, signupId, record) {
  const remaining = Math.ceil((Date.parse(record.expires_at) - nowMs()) / 1000);
  await kv.put(APPLICATION_PREFIX + signupId, JSON.stringify(record), {
    expirationTtl: Math.max(60, remaining),
    metadata: { s: "unconfirmed", n: String(record.name || "").slice(0, 80), at: record.received_at }
  });
}

export const verifyUrlFor = (token) => `${SITE_URL}/api/verify-affiliate?token=${token}`;

/** Sends (or re-sends) the confirmation email to the address stored on the signup. */
export async function sendConfirmation(env, record) {
  const message = buildConfirmationEmail({ name: record.name, verifyUrl: verifyUrlFor(record.verify_token) });
  return sendViaResend(env, { to: record.email, subject: message.subject, html: message.html, text: message.text });
}

/* ---- finding an affiliate by email (for "resend my welcome email") ---- */

export async function findAffiliateByEmail(kv, emailNorm) {
  const owner = await readOwner(kv, idxEmailKey(emailNorm));
  if (owner && owner.type === "affiliate" && owner.code) {
    const record = await getJson(kv, AFFILIATE_PREFIX + owner.code);
    if (record) return { code: owner.code, record };
  }
  // Affiliates approved before the index existed (Rebuild index not run yet): match on the
  // address in each record's metadata. One list(), no get() per affiliate.
  const keys = await listAll(kv, AFFILIATE_PREFIX);
  for (const key of keys) {
    const meta = key.metadata;
    if (meta && typeof meta.e === "string" && normaliseEmail(meta.e) === emailNorm) {
      const record = await getJson(kv, key.name);
      if (record) return { code: key.name.slice(AFFILIATE_PREFIX.length), record };
    }
  }
  return null;
}

/* ---- emails that follow a confirmation ---- */

/** Sends the standard welcome email to an affiliate's registered address. Never throws. */
export async function sendWelcomeTo(env, code, record) {
  try {
    const message = buildWelcomeEmail({ name: record.name, code });
    return await sendViaResend(env, { to: String(record.email).trim(), subject: message.subject, html: message.html, text: message.text });
  } catch (err) {
    return { ok: false, error: "Could not build or send the welcome email." };
  }
}

/** The affiliate's KV metadata, kept in one place so every writer produces the same shape. */
export function affiliateMetadata(record) {
  const meta = {
    n: String(record.name || "").slice(0, 100),
    e: String(record.email || ""),
    at: record.approved_at,
    s: record.status || "active",
    src: record.source || "admin"
  };
  if (record.application_key) meta.k = record.application_key;
  if (record.email_verified_at) meta.v = record.email_verified_at;
  return meta;
}

/* ---- confirmation: creates the affiliate ---- */

async function codeIsTaken(kv, code, applicationKey) {
  const existing = await getJson(kv, AFFILIATE_PREFIX + code);
  if (existing) return existing.application_key !== applicationKey;   // our own half-finished attempt is not "taken"
  // Never reuse a code that ever earned or was paid anything, even if its affiliate record is gone.
  for (const prefix of [REFERRAL_PREFIX, PAYOUT_PREFIX]) {
    const page = await kv.list({ prefix: `${prefix}${code}:`, limit: 1 });
    if (page.keys.length) return true;
  }
  return false;
}

/**
 * Idempotent. Returns { status: "ok", code } | { status: "expired" } | { status: "invalid" }.
 * Mail scanners prefetch links, so opening the link twice must not create anything twice:
 * the second visit just reports the same code.
 */
export async function confirmSignup(env, token) {
  const kv = env.REFERRALS_KV;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return { status: "invalid" };

  const tokenKey = VERIFY_PREFIX + token;
  const tokenRecord = await getJson(kv, tokenKey);
  if (!tokenRecord || !tokenRecord.signup_id) return { status: "expired" };

  // Used before: same answer as the first time. (If the welcome email failed back then, this is
  // the moment to try it once more; if it went out, nothing is sent again.)
  if (tokenRecord.code) {
    const affiliate = await getJson(kv, AFFILIATE_PREFIX + tokenRecord.code);
    if (affiliate && affiliate.welcome_email && affiliate.welcome_email.ok === false) {
      await deliverWelcome(env, tokenRecord.code, affiliate);
    }
    return { status: "ok", code: tokenRecord.code };
  }

  const applicationKey = APPLICATION_PREFIX + tokenRecord.signup_id;
  const app = await getJson(kv, applicationKey);
  if (!app) return { status: "expired" };
  if (app.status === "approved" && app.approved_code) {
    await kv.put(tokenKey, JSON.stringify({ signup_id: tokenRecord.signup_id, code: app.approved_code, used_at: nowIso() }), { expirationTtl: USED_TOKEN_TTL_SEC });
    return { status: "ok", code: app.approved_code };
  }
  if (app.status !== "unconfirmed") return { status: "invalid" };

  // Pick a code and write the affiliate. The digits are derived from the signup id, so a request
  // racing this one walks the same sequence and lands on the same code.
  const verifiedAt = nowIso();
  let code;
  let record;
  for (let tries = 0; tries < 5; tries++) {
    code = await pickCode({ name: app.name, seed: tokenRecord.signup_id, isTaken: (c) => codeIsTaken(kv, c, applicationKey) });
    record = {
      name: app.name,
      email: app.email,
      phone: app.phone_normalised,
      approved_at: verifiedAt,
      application_key: applicationKey,
      status: "active",
      source: "self-signup",
      email_verified_at: verifiedAt
    };
    await kv.put(AFFILIATE_PREFIX + code, JSON.stringify(record), { metadata: affiliateMetadata(record) });
    const check = await getJson(kv, AFFILIATE_PREFIX + code);
    if (check && check.application_key === applicationKey) break;   // still ours: done
    code = null;                                                     // someone else wrote it meanwhile: pick again
  }
  if (!code) return { status: "invalid" };

  // Make the signup permanent: no TTL on the application, the idx keys or (for a while) the token.
  const approvedApp = { ...app, status: "approved", approved_code: code, approved_at: verifiedAt, email_verified_at: verifiedAt };
  delete approvedApp.verify_token;
  delete approvedApp.expires_at;
  await kv.put(applicationKey, JSON.stringify(approvedApp), { metadata: { s: "approved", n: String(app.name || "").slice(0, 80), at: verifiedAt } });
  const owner = JSON.stringify({ type: "affiliate", code, at: verifiedAt });
  await kv.put(idxEmailKey(app.email_normalised), owner);
  await kv.put(idxPhoneKey(app.phone_normalised), owner);
  await kv.put(tokenKey, JSON.stringify({ signup_id: tokenRecord.signup_id, code, used_at: verifiedAt }), { expirationTtl: USED_TOKEN_TTL_SEC });

  await deliverWelcome(env, code, record);
  // A short notice to the XNY Farms inbox. Best effort; never affects the affiliate.
  try {
    const notice = buildAdminNotice({ name: app.name, code, email: app.email });
    await sendViaResend(env, { to: REPLY_TO, subject: notice.subject, html: notice.html, text: notice.text });
  } catch (err) { /* see above */ }

  return { status: "ok", code };
}

/** Sends the welcome email and records the outcome on the affiliate record. */
async function deliverWelcome(env, code, record) {
  const kv = env.REFERRALS_KV;
  const sent = await sendWelcomeTo(env, code, record);
  try {
    const fresh = (await getJson(kv, AFFILIATE_PREFIX + code)) || record;
    fresh.welcome_email = { at: nowIso(), ok: sent.ok === true, error: sent.ok ? "" : String(sent.error || "").slice(0, 300) };
    await kv.put(AFFILIATE_PREFIX + code, JSON.stringify(fresh), { metadata: affiliateMetadata(fresh) });
  } catch (err) { /* the email itself has been tried; the status is a convenience */ }
  return sent;
}
