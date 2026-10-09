/**
 * POST /api/rebuild-index — Cloudflare Pages Function
 *
 * Password-gated, one-time-after-deploy admin action: builds the duplicate-detection
 * index (idx:email:{normalised}, idx:phone:{normalised}) for every EXISTING affiliate,
 * so affiliates registered before self-signup existed are protected from being
 * registered again.
 *   email  — from the affiliate record
 *   phone  — from the affiliate's linked application (application_key), else the most
 *            recent application with the same email
 * Safe to run again: keys that already point at the right affiliate are left alone.
 *
 * It only writes idx keys. It NEVER changes an affiliate. If two existing affiliates
 * share an email or phone, the OLDER one keeps the index key and the clash is listed in
 * `conflicts` for the admin to look at.
 *
 * -> { ok, affiliates, indexed_email, indexed_phone, already_indexed_email,
 *      already_indexed_phone, no_email, no_phone, invalid_phone, conflicts: [{ field, value, codes, note? }] }
 *
 * Cost: about two KV writes per affiliate (plus a read each). Cloudflare caps KV operations
 * per request, so with several hundred affiliates this may need to be run more than once;
 * it picks up where it left off.
 */
import { loadAffiliates, resolvePayoutDetails } from "../_lib/payouts.js";
import { normaliseEmail, normalisePhoneIntl, nowIso } from "../_lib/identity.js";
import { idxEmailKey, idxPhoneKey, liveOwner } from "../_lib/signup.js";
import { getJson } from "../_lib/payouts.js";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
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

const maskPhone = (digits) => (digits.length > 4 ? "•".repeat(digits.length - 4) + digits.slice(-4) : digits);

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ADMIN_REPORT_PASSWORD) return json({ ok: false, error: "ADMIN_REPORT_PASSWORD is not set. Add it to this Pages project under Settings → Environment variables, then redeploy." }, 503);
  if (!env.REFERRALS_KV) return json({ ok: false, error: "REFERRALS_KV is not bound. Create a KV namespace named REFERRALS_KV and bind it to this Pages project under Settings → Functions → KV namespace bindings." }, 503);
  const kv = env.REFERRALS_KV;

  let body;
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Body must be valid JSON." }, 400); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "Body must be a JSON object." }, 400);
  if (!timingSafeEqual(typeof body.password === "string" ? body.password : "", env.ADMIN_REPORT_PASSWORD)) {
    return json({ ok: false, error: "Incorrect password." }, 401);
  }

  let affiliates;
  let details;
  try {
    affiliates = await loadAffiliates(kv);
    affiliates.sort((a, b) => String(a.approved_at || "").localeCompare(String(b.approved_at || "")) || a.code.localeCompare(b.code));   // oldest first: the oldest keeps a contested key
    details = await resolvePayoutDetails(kv, affiliates);
  } catch (err) {
    return json({ ok: false, error: "Could not read the affiliates." }, 500);
  }

  const result = {
    affiliates: affiliates.length,
    indexed_email: 0, indexed_phone: 0,
    already_indexed_email: 0, already_indexed_phone: 0,
    no_email: 0, no_phone: 0, invalid_phone: 0,
    conflicts: []
  };
  const seen = new Map();   // idx key -> code that holds it, so a clash inside this run is caught even before KV catches up

  async function index(field, key, display, aff) {
    const holder = seen.get(key);
    if (holder && holder !== aff.code) {
      result.conflicts.push({ field, value: display, codes: [holder, aff.code] });
      return;
    }
    const existing = await getJson(kv, key);
    const live = await liveOwner(kv, existing);
    if (live && live.kind === "confirmed" && live.code === aff.code) {
      result[`already_indexed_${field}`]++;
      seen.set(key, aff.code);
      return;
    }
    if (live) {
      result.conflicts.push({
        field, value: display,
        codes: live.kind === "confirmed" ? [live.code, aff.code] : [aff.code],
        note: live.kind === "confirmed" ? undefined : "also used by a signup waiting for confirmation"
      });
      return;
    }
    await kv.put(key, JSON.stringify({ type: "affiliate", code: aff.code, at: nowIso() }));
    seen.set(key, aff.code);
    result[`indexed_${field}`]++;
  }

  try {
    for (const aff of affiliates) {
      const emailNorm = normaliseEmail(aff.email);
      if (emailNorm) await index("email", idxEmailKey(emailNorm), emailNorm, aff); else result.no_email++;

      const rawPhone = (details.get(aff.code) || {}).phone || "";
      if (!rawPhone) { result.no_phone++; continue; }
      const phone = normalisePhoneIntl(rawPhone);
      if (!phone.ok) { result.invalid_phone++; continue; }
      await index("phone", idxPhoneKey(phone.phone), maskPhone(phone.phone), aff);
    }
  } catch (err) {
    return json({ ok: false, error: "Stopped part-way (KV error). Run it again to continue.", ...result }, 500);
  }

  return json({ ok: true, ...result });
}
