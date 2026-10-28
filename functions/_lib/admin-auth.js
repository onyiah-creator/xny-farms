/**
 * The gate shared by every admin endpoint: Cloudflare Access (optional, then required), then the password.
 *
 * Layer 1, Cloudflare Access. Behind an Access application, Cloudflare puts a signed JWT in the
 * Cf-Access-Jwt-Assertion header. verifyAccessJwt checks it with WebCrypto: RS256 only, signature against
 * https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs (keys cached in memory for 10 minutes; one refetch
 * on an unknown kid, at most once every 30 seconds), iss, aud (CF_ACCESS_AUD), exp and nbf (30 s of clock
 * leeway), and an email claim. When ACCESS_ENFORCE is exactly "true" every admin endpoint needs a valid
 * JWT in addition to the password and fails closed (403) if CF_ACCESS_TEAM_DOMAIN or CF_ACCESS_AUD is
 * missing, the JWKS can't be fetched, or the JWT is absent or invalid. Otherwise the JWT is still
 * validated and used for the audit log when present, but is not required. Enforcement is decided by the
 * variable alone, never by the hostname. Enforced checks happen BEFORE the password is looked at, so a
 * caller outside Access can't even use the password lockout.
 *
 * Layer 2, the password. Compares the supplied password with ADMIN_REPORT_PASSWORD in constant time, and adds
 * brute-force protection: after MAX_FAILURES wrong passwords from one IP within
 * WINDOW_SEC, that IP is refused outright (HTTP 429), even with the right password,
 * until the window passes. A correct password clears the count. Other IPs are unaffected.
 *
 * Counters are KV fixed windows (eventually consistent, no atomic increment), so under a
 * burst a few extra guesses can slip through; the bound is on the order of MAX_FAILURES, not
 * millions. Use a long random ADMIN_REPORT_PASSWORD regardless.
 *
 * Lives in functions/_lib/ and exports no onRequest* handler, so Pages does not route it.
 */
import { writeAudit } from "./audit.js";

export const MAX_FAILURES = 10;
export const WINDOW_SEC = 15 * 60;
export const PASSWORD_ONLY = "password-only";

/** Every endpoint that goes through adminDenied (the middleware adds the admin headers to these). */
export const ADMIN_API_PATHS = [
  "admin-pricing", "get-affiliates", "get-pending-applications", "get-referrals", "rebuild-index",
  "record-payout", "register-affiliate", "send-affiliate-email", "set-affiliate-status",
  "admin-status", "get-audit-log"
];

/* ---------------- Cloudflare Access JWT ---------------- */

const JWKS_TTL_MS = 10 * 60 * 1000;
const MISS_REFETCH_COOLDOWN_MS = 30 * 1000;
const LEEWAY_SEC = 30;
const MAX_JWT_LENGTH = 8192;
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

let jwksCache = { domain: null, fetchedAt: 0, keys: new Map() };
let lastMissRefetchAt = -Infinity;
let inflight = null;

/** For tests: forget the cached keys and the refetch cooldown. */
export function resetAccessCache() {
  jwksCache = { domain: null, fetchedAt: 0, keys: new Map() };
  lastMissRefetchAt = -Infinity;
  inflight = null;
}

function normaliseDomain(v) {
  if (typeof v !== "string") return "";
  const d = v.trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/+$/, "");
  return d.length <= 253 && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(d) ? d : "";
}

export function accessConfig(env) {
  const domain = normaliseDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const aud = typeof env.CF_ACCESS_AUD === "string" ? env.CF_ACCESS_AUD.trim() : "";
  return { enforce: env.ACCESS_ENFORCE === "true", domain, aud, configured: Boolean(domain && aud) };
}

function b64uToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64uToJson = (s) => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

async function refreshKeys(domain) {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`https://${domain}/cdn-cgi/access/certs`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("certs HTTP " + res.status);
      const doc = await res.json();
      if (!doc || !Array.isArray(doc.keys)) throw new Error("certs: no keys");
      const keys = new Map();
      for (const jwk of doc.keys) {
        if (!jwk || jwk.kty !== "RSA" || typeof jwk.kid !== "string" || (jwk.alg && jwk.alg !== "RS256")) continue;
        try {
          keys.set(jwk.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, RS256, false, ["verify"]));
        } catch (err) { /* skip an unusable key */ }
      }
      if (!keys.size) throw new Error("certs: no usable keys");
      jwksCache = { domain, fetchedAt: Date.now(), keys };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The verification key for `kid`, or undefined. Throws if the keys can't be fetched. */
async function keyFor(domain, kid) {
  const now = Date.now();
  let justFetched = false;
  if (jwksCache.domain !== domain || now - jwksCache.fetchedAt >= JWKS_TTL_MS) { await refreshKeys(domain); justFetched = true; }
  let key = jwksCache.keys.get(kid);
  if (!key && !justFetched && now - lastMissRefetchAt >= MISS_REFETCH_COOLDOWN_MS) {
    lastMissRefetchAt = now;           // an unknown kid usually means Cloudflare rotated its keys: look once more
    await refreshKeys(domain);
    key = jwksCache.keys.get(kid);
  }
  return key;
}

/**
 * Verifies a Cf-Access-Jwt-Assertion value. Returns { ok: true, email, claims } or { ok: false, reason }.
 * Never throws.
 */
export async function verifyAccessJwt(token, env) {
  const fail = (reason) => ({ ok: false, reason });
  try {
    const cfg = accessConfig(env);
    if (!cfg.configured) return fail("not_configured");
    if (typeof token !== "string" || !token || token.length > MAX_JWT_LENGTH) return fail("missing");
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return fail("malformed");

    let header, claims;
    try { header = b64uToJson(parts[0]); claims = b64uToJson(parts[1]); } catch (err) { return fail("malformed"); }
    if (!header || typeof header !== "object" || !claims || typeof claims !== "object") return fail("malformed");
    if (header.alg !== "RS256") return fail("bad_alg");            // rejects "none", HS256 and everything else
    if (typeof header.kid !== "string" || !header.kid) return fail("no_kid");

    let key;
    try { key = await keyFor(cfg.domain, header.kid); } catch (err) { return fail("jwks_unavailable"); }
    if (!key) return fail("unknown_kid");

    const valid = await crypto.subtle.verify(RS256, key, b64uToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!valid) return fail("bad_signature");

    if (claims.iss !== `https://${cfg.domain}`) return fail("bad_iss");
    const audOk = Array.isArray(claims.aud) ? claims.aud.includes(cfg.aud) : claims.aud === cfg.aud;
    if (!audOk) return fail("bad_aud");
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== "number" || !(claims.exp + LEEWAY_SEC > now)) return fail("expired");
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - LEEWAY_SEC > now)) return fail("not_yet_valid");
    const email = typeof claims.email === "string" ? claims.email.trim() : "";
    if (!email || !email.includes("@")) return fail("no_email");   // service tokens carry no email: not an admin
    return { ok: true, email, claims };
  } catch (err) {
    return fail("error");
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

/** Length-independent comparison, so a wrong password can't be narrowed down by timing. */
export function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

async function readFailures(kv, key) {
  try {
    const raw = await kv.get(key);
    const rec = raw ? JSON.parse(raw) : null;
    if (rec && typeof rec.start === "number" && Date.now() - rec.start < WINDOW_SEC * 1000) return rec;
  } catch (err) { /* treat as no record */ }
  return null;
}

/**
 * Returns a Response when the caller must stop (403 no valid Access JWT, 401 wrong password, 429 locked
 * out), otherwise { email, ip }: the verified Access email, or "password-only", and the caller's IP,
 * for the audit log. Callers write
 *     const auth = await adminDenied(request, env, body);
 *     if (auth instanceof Response) return auth;
 * They have already checked that ADMIN_REPORT_PASSWORD and REFERRALS_KV exist.
 */
export async function adminDenied(request, env, body) {
  const kv = env.REFERRALS_KV;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  // Layer 1: Cloudflare Access.
  const cfg = accessConfig(env);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  let accessEmail = null;
  if (cfg.enforce) {
    const locked = (error) => json({ ok: false, code: "access_required", error }, 403);
    if (!cfg.configured) return locked("Admin access is locked: Cloudflare Access is switched on but not fully configured.");
    if (!token) return locked("Cloudflare Access sign-in is required.");
    const checked = await verifyAccessJwt(token, env);
    if (!checked.ok) return locked("Cloudflare Access sign-in is required.");
    accessEmail = checked.email;
  } else if (token && cfg.configured) {
    const checked = await verifyAccessJwt(token, env);
    if (checked.ok) accessEmail = checked.email;
  }
  const actor = { email: accessEmail || PASSWORD_ONLY, ip };

  // Layer 2: the password, with brute-force lockout.
  const key = `rl:adminfail:${ip}`;
  const state = await readFailures(kv, key);
  if (state && state.n >= MAX_FAILURES) {
    const wait = Math.max(1, Math.ceil((state.start + WINDOW_SEC * 1000 - Date.now()) / 60000));
    return json({ ok: false, error: `Too many failed attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` }, 429);
  }

  const supplied = body && typeof body.password === "string" ? body.password : "";
  if (timingSafeEqual(supplied, env.ADMIN_REPORT_PASSWORD)) {
    if (state) { try { await kv.delete(key); } catch (err) { /* the window will expire it */ } }
    return actor;
  }

  const start = state ? state.start : Date.now();
  const n = (state ? state.n : 0) + 1;
  const remaining = Math.max(60, Math.ceil((start + WINDOW_SEC * 1000 - Date.now()) / 1000));
  try { await kv.put(key, JSON.stringify({ n, start }), { expirationTtl: remaining }); } catch (err) { /* still refuse */ }
  if (n === MAX_FAILURES) await writeAudit(env, actor, "admin.lockout", `Locked out after ${MAX_FAILURES} wrong passwords in ${WINDOW_SEC / 60} minutes`);
  return json({ ok: false, error: "Incorrect password." }, 401);
}
