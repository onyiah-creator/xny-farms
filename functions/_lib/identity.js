/**
 * Identity helpers for self-service affiliate signup: duplicate-detection
 * normalisation, referral-code generation, tokens and rate limiting.
 *
 * Pure or KV-only; no network. Lives in functions/_lib/ and exports no
 * onRequest* handler, so Pages does not make it a route.
 *
 * Time: everything reads the clock through Date.now() (never `new Date()` on
 * its own), so tests can move time.
 */

export const nowMs = () => Date.now();
export const nowIso = () => new Date(Date.now()).toISOString();

/* ------------------------------------------------------------------ *
 * Email normalisation (for duplicate detection ONLY; the address an  *
 * email is sent to is always the one the person typed.)              *
 *   trim + lowercase; drop any "+tag" from the local part;           *
 *   gmail.com / googlemail.com: also drop dots, googlemail -> gmail  *
 * ------------------------------------------------------------------ */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the normalised address, or null if it isn't a plausible email. */
export function normaliseEmail(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s.length > 254 || !EMAIL_PATTERN.test(s)) return null;
  const at = s.lastIndexOf("@");
  let local = s.slice(0, at);
  let domain = s.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus !== -1) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  if (!local || !domain) return null;
  return `${local}@${domain}`;
}

/* ------------------------------------------------------------------ *
 * Phone normalisation (for duplicate detection and storage)          *
 *   strips spaces, dashes, dots, brackets; a leading "+" (or "00")   *
 *   marks an explicit international number.                          *
 *   Nigeria: 0XXXXXXXXXX (11 digits) -> 234XXXXXXXXXX; 234… must be  *
 *   exactly 13 digits. Other countries: only with an explicit +, and *
 *   8-15 digits. Anything else is rejected.                          *
 * ------------------------------------------------------------------ */
/** Returns { ok: true, phone } (digits only, no "+"), or { ok: false, error }. */
export function normalisePhoneIntl(raw) {
  if (typeof raw !== "string") return { ok: false, error: "Enter a phone number." };
  let s = raw.trim();
  if (!s) return { ok: false, error: "Enter a phone number." };
  if (s.length > 32) return { ok: false, error: "That phone number is too long." };
  let international = false;
  if (s.startsWith("+")) { international = true; s = s.slice(1); }
  s = s.replace(/[\s\-().]/g, "");
  if (!international && s.startsWith("00")) { international = true; s = s.slice(2); }
  if (!/^\d+$/.test(s)) return { ok: false, error: "Phone numbers can only contain digits, spaces, dashes, brackets and a leading +." };

  if (s.startsWith("234")) {
    // Nigerian country code: it has a fixed length, whichever way it was typed.
    if (s.length === 13) return { ok: true, phone: s };
    return { ok: false, error: "That Nigerian number doesn't look right. Use 0803 123 4567 or +234 803 123 4567." };
  }
  if (!international && s.length === 11 && s.startsWith("0")) return { ok: true, phone: "234" + s.slice(1) };
  if (international) {
    if (s.length >= 8 && s.length <= 15 && !s.startsWith("0")) return { ok: true, phone: s };
    return { ok: false, error: "International numbers need 8 to 15 digits after the +." };
  }
  return { ok: false, error: "Enter a Nigerian number like 0803 123 4567, or an international number starting with +." };
}

/* ------------------------------------------------------------------ *
 * Referral code generation                                           *
 * ------------------------------------------------------------------ */
export const RESERVED_CODES = new Set([
  "ADMIN", "ADMINISTRATOR", "XNY", "XNYFARMS", "XNYFARM", "FARMS", "FARM", "TEST", "TESTING", "ROOT",
  "SUPPORT", "STAFF", "OWNER", "NULL", "NONE", "UNDEFINED", "HELP", "INFO", "SALES", "AFFILIATE",
  "WHOLESALE", "ASHE", "HONEY", "PALM", "API", "WWW", "MAIL", "EMAIL", "SYSTEM", "DEMO", "GUEST",
  "USER", "CODE", "REF", "SHOP", "STORE", "PAYMENT", "PAYOUT", "BILLING"
]);

const lettersOnly = (s) => String(s || "").normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase();

/** First 3 letters of the first name + first 4 of the last name, A-Z only.
 *  Short names are padded from the rest of the name; always at least 3 letters. */
export function codeBase(name) {
  const tokens = String(name || "").split(/\s+/).map(lettersOnly).filter(Boolean);
  if (!tokens.length) return "AFF";
  const first = tokens[0];
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : "";
  let base = first.slice(0, 3) + last.slice(0, 4);
  if (base.length < 5) {
    base += (first.slice(3) + last.slice(4)).slice(0, 5 - base.length);
  }
  while (base.length < 3) base += "AFF".charAt(base.length % 3);
  return base;
}

async function sha256Int(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
}

/** The n-th candidate for a name. n = 0 is the plain base; later ones append a
 *  2-digit number (3 digits after many collisions). The digits come from a hash
 *  of `seed`, so one signup always walks the SAME sequence: two requests racing
 *  to confirm the same signup land on the same code instead of two different ones. */
export async function codeCandidate(name, seed, attempt) {
  const base = codeBase(name);
  if (attempt === 0) return base;
  const h = await sha256Int(`${seed}:${attempt}`);
  return attempt <= 40 ? base + String(10 + (h % 90)) : base + String(100 + (h % 900));
}

/** Picks the first candidate that is neither reserved nor taken. `isTaken(code)` is async. */
export async function pickCode({ name, seed, isTaken, maxAttempts = 200 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = await codeCandidate(name, seed, attempt);
    if (RESERVED_CODES.has(candidate)) continue;
    if (await isTaken(candidate)) continue;
    return candidate;
  }
  throw new Error("Could not find a free referral code.");
}

/* ------------------------------------------------------------------ *
 * Tokens and rate limiting                                           *
 * ------------------------------------------------------------------ */
/** 32 random bytes as 64 hex characters. */
export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function shortId() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fixed-window counter in KV. Counts this call and says whether it is within
 * `limit` for the window. KV is eventually consistent and has no atomic
 * increment, so two simultaneous requests can both read the same count: the
 * limit is a brake on abuse, not an exact quota.
 * Returns { allowed, count, retryAfterSec }.
 */
export async function rateLimit(kv, key, limit, windowSec) {
  const now = nowMs();
  let rec = null;
  try {
    const raw = await kv.get(key);
    rec = raw ? JSON.parse(raw) : null;
  } catch (err) { rec = null; }
  const fresh = !rec || typeof rec.start !== "number" || now - rec.start >= windowSec * 1000;
  const start = fresh ? now : rec.start;
  const count = fresh ? 1 : (Number(rec.n) || 0) + 1;
  const remainingSec = Math.max(1, Math.ceil((start + windowSec * 1000 - now) / 1000));
  await kv.put(key, JSON.stringify({ n: count, start }), { expirationTtl: Math.max(60, remainingSec) });
  return { allowed: count <= limit, count, retryAfterSec: remainingSec };
}

export const CLIENT_IP = (request) => request.headers.get("CF-Connecting-IP") || "unknown";
