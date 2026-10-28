/**
 * The admin audit log.
 *
 * One KV record per sensitive admin action:  audit:{ISO time}-{shortId}
 *   { at, actor_email, actor_ip, action, summary }
 * with the same fields in the KV metadata, so the log can be listed (newest 200) from list()
 * alone, with no get() per record. Records expire after 400 days.
 *
 * actor_email is the Cloudflare Access email when the request carried a valid Access JWT, otherwise
 * "password-only". `summary` is a short plain-words line built by the caller from safe values only
 * (amounts, codes, affiliate names, version numbers). It must never hold a password, an account
 * number, a token, an email address of an affiliate or a whole request body; writeAudit also strips
 * control characters and caps the length.
 *
 * Writing is best effort: a KV hiccup is swallowed so that an audit failure can never undo or block
 * the action it describes (writeAudit returns false so a caller can tell).
 *
 * Lives in functions/_lib/ and exports no onRequest* handler, so Pages does not route it.
 */
export const AUDIT_PREFIX = "audit:";
export const AUDIT_TTL_SEC = 400 * 24 * 60 * 60;
export const AUDIT_READ_LIMIT = 200;
const MAX_SUMMARY = 300;
const META_BUDGET = 900;   // KV metadata is capped at 1024 bytes of JSON

const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const byteLength = (s) => new TextEncoder().encode(s).length;

function shortId() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Builds the record, trimming the summary until the metadata fits KV's limit. */
export function buildAuditRecord({ actor, ip, action, summary }, at) {
  const rec = {
    at,
    actor_email: clean(actor, 120) || "password-only",
    actor_ip: clean(ip, 45) || "unknown",
    action: clean(action, 40),
    summary: clean(summary, MAX_SUMMARY)
  };
  while (rec.summary && byteLength(JSON.stringify(rec)) > META_BUDGET) rec.summary = rec.summary.slice(0, Math.max(0, rec.summary.length - 20));
  return rec;
}

/**
 * Records one admin action. `auth` is what adminDenied returned ({ email, ip }); pass { email, ip }
 * by hand for the one case that has no verified actor (a lockout).
 */
export async function writeAudit(env, auth, action, summary) {
  const kv = env && env.REFERRALS_KV;
  if (!kv || !action) return false;
  try {
    const at = new Date(Date.now()).toISOString();
    const rec = buildAuditRecord({ actor: auth && auth.email, ip: auth && auth.ip, action, summary }, at);
    await kv.put(`${AUDIT_PREFIX}${at}-${shortId()}`, JSON.stringify(rec), { expirationTtl: AUDIT_TTL_SEC, metadata: rec });
    return true;
  } catch (err) {
    return false;
  }
}

/** Newest-first entries (at most `limit`), read from KV metadata only. */
export async function readAudit(kv, limit = AUDIT_READ_LIMIT) {
  const names = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: AUDIT_PREFIX, cursor, limit: 1000 });
    for (const k of page.keys) names.push(k);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  names.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const wanted = names.slice(0, limit);
  const entries = [];
  for (const k of wanted) {
    const m = k.metadata;
    if (m && typeof m === "object") entries.push({ at: m.at, actor_email: m.actor_email, actor_ip: m.actor_ip, action: m.action, summary: m.summary });
  }
  return { entries, total: names.length };
}
