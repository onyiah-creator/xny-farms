/**
 * The password gate shared by every admin endpoint.
 *
 * Compares the supplied password with ADMIN_REPORT_PASSWORD in constant time, and adds
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
export const MAX_FAILURES = 10;
export const WINDOW_SEC = 15 * 60;

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
 * Returns null when the caller may proceed, otherwise the Response to send (401 wrong password,
 * 429 locked out). The caller has already checked that ADMIN_REPORT_PASSWORD and REFERRALS_KV exist.
 */
export async function adminDenied(request, env, body) {
  const kv = env.REFERRALS_KV;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `rl:adminfail:${ip}`;

  const state = await readFailures(kv, key);
  if (state && state.n >= MAX_FAILURES) {
    const wait = Math.max(1, Math.ceil((state.start + WINDOW_SEC * 1000 - Date.now()) / 60000));
    return json({ ok: false, error: `Too many failed attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` }, 429);
  }

  const supplied = body && typeof body.password === "string" ? body.password : "";
  if (timingSafeEqual(supplied, env.ADMIN_REPORT_PASSWORD)) {
    if (state) { try { await kv.delete(key); } catch (err) { /* the window will expire it */ } }
    return null;
  }

  const start = state ? state.start : Date.now();
  const n = (state ? state.n : 0) + 1;
  const remaining = Math.max(60, Math.ceil((start + WINDOW_SEC * 1000 - Date.now()) / 1000));
  try { await kv.put(key, JSON.stringify({ n, start }), { expirationTtl: remaining }); } catch (err) { /* still refuse */ }
  return json({ ok: false, error: "Incorrect password." }, 401);
}
