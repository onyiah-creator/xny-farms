/**
 * POST /api/admin-pricing — Cloudflare Pages Function. Password-gated (ADMIN_REPORT_PASSWORD).
 *
 * Body (JSON): { password, action, ... }
 *   get        -> { ok, config, versions: [last 50 summaries], persisted }
 *   save       -> { products?, commission_rate?, processor_fee_rate?, delivery?,
 *                   pass_fee_on_delivery?, rounding_step_ngn?, note?, expected_version? }
 *                 Validates, then writes a NEW immutable version and moves the pointer.
 *                 Fields left out keep their current value. expected_version (optional)
 *                 refuses the save if someone else has saved since the page loaded.
 *   preview    -> same fields as save, but writes NOTHING: { ok, changes } or { ok:false, error }
 *                 (the admin page uses it to show what a save would change before confirming)
 *   history    -> { limit?: up to 50, version?: n } list, or one full snapshot
 *   revert_to  -> { version, note? } writes a NEW version that copies the old one.
 *                 Nothing is ever deleted or overwritten: history is the change log.
 *
 * Rates are fractions (0.08 = 8%). Prices are whole naira. See _lib/pricing.js for the rules.
 */
import { adminDenied } from "../_lib/admin-auth.js";
import { writeAudit } from "../_lib/audit.js";
import { loadCurrent, getSnapshot, validateSave, diffConfigs, writeNewVersion, listVersions, cloneConfig } from "../_lib/pricing.js";

const HISTORY_MAX = 50;

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

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ADMIN_REPORT_PASSWORD) {
    return json({ ok: false, error: "ADMIN_REPORT_PASSWORD is not set. Add it to this Pages project under Settings → Environment variables, then redeploy." }, 503);
  }
  if (!env.REFERRALS_KV) {
    return json({ ok: false, error: "REFERRALS_KV is not bound. Create a KV namespace named REFERRALS_KV and bind it to this Pages project under Settings → Functions → KV namespace bindings." }, 503);
  }
  const kv = env.REFERRALS_KV;

  let body;
  try { body = await request.json(); } catch (err) { return json({ ok: false, error: "Body must be valid JSON." }, 400); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "Body must be a JSON object." }, 400);
  // Constant-time password check, with a lockout after repeated failures from one IP.
  const auth = await adminDenied(request, env, body);
  if (auth instanceof Response) return auth;

  const action = body.action;
  try {
    if (action === "get") {
      const { config, persisted } = await loadCurrent(kv);
      return json({ ok: true, config, persisted, versions: await listVersions(kv, HISTORY_MAX) });
    }

    if (action === "history") {
      if (body.version !== undefined) {
        if (!Number.isInteger(body.version)) return json({ ok: false, error: "version must be a whole number." }, 400);
        const snap = await getSnapshot(kv, body.version);
        return snap ? json({ ok: true, config: snap }) : json({ ok: false, error: `Version ${body.version} does not exist.` }, 404);
      }
      const limit = Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), HISTORY_MAX) : HISTORY_MAX;
      return json({ ok: true, versions: await listVersions(kv, limit) });
    }

    if (action === "preview") {
      const { config: current } = await loadCurrent(kv);
      const checked = validateSave(body, current);
      if (!checked.ok) return json({ ok: false, error: checked.error }, 400);
      return json({ ok: true, changes: diffConfigs(current, checked.config), version: current.version });
    }

    if (action === "save") {
      const { config: current } = await loadCurrent(kv);
      if (body.expected_version !== undefined && body.expected_version !== current.version) {
        return json({ ok: false, conflict: true, current_version: current.version, error: `Pricing was changed (now version ${current.version}) since this page was loaded. Reload to see the latest before saving.` }, 409);
      }
      const checked = validateSave(body, current);
      if (!checked.ok) return json({ ok: false, error: checked.error }, 400);
      checked.config.changed_by = auth.email;
      const snapshot = await writeNewVersion(kv, checked.config, new Date(Date.now()).toISOString());
      const changes = diffConfigs(current, snapshot);
      await writeAudit(env, auth, "pricing.save", `Saved pricing version ${snapshot.version}: ${changes.join("; ") || "no visible changes"}`);
      return json({ ok: true, version: snapshot.version, config: snapshot, changes });
    }

    if (action === "revert_to") {
      if (!Number.isInteger(body.version)) return json({ ok: false, error: "version must be a whole number." }, 400);
      const old = await getSnapshot(kv, body.version);
      if (!old) return json({ ok: false, error: `Version ${body.version} does not exist.` }, 404);
      const { config: current } = await loadCurrent(kv);
      if (body.expected_version !== undefined && body.expected_version !== current.version) {
        return json({ ok: false, conflict: true, current_version: current.version, error: "Pricing was changed since this page was loaded. Reload and try again." }, 409);
      }
      // Re-use the save path so a revert is validated exactly like any other change.
      const asInput = {
        products: Object.fromEntries(Object.entries(old.products).map(([id, p]) => [id, { price_ngn: p.price_ngn, target_net_ngn: p.target_net_ngn, other_cost_ngn: p.other_cost_ngn || 0 }])),
        commission_rate: old.commission_rate,
        processor_fee_rate: old.processor_fee_rate,
        delivery: cloneConfig(old.delivery),
        pass_fee_on_delivery: old.pass_fee_on_delivery,
        rounding_step_ngn: old.rounding_step_ngn,
        note: typeof body.note === "string" && body.note.trim() ? body.note : `Reverted to version ${old.version}`
      };
      const checked = validateSave(asInput, current);
      if (!checked.ok) return json({ ok: false, error: /Nothing has changed/.test(checked.error) ? `Version ${old.version} is identical to the current prices, so there is nothing to revert.` : checked.error }, 400);
      checked.config.reverted_from = old.version;
      checked.config.changed_by = auth.email;
      const snapshot = await writeNewVersion(kv, checked.config, new Date(Date.now()).toISOString());
      const changes = diffConfigs(current, snapshot);
      await writeAudit(env, auth, "pricing.revert", `Reverted to version ${old.version}, saved as version ${snapshot.version}: ${changes.join("; ") || "no visible changes"}`);
      return json({ ok: true, version: snapshot.version, reverted_from: old.version, config: snapshot, changes });
    }
  } catch (err) {
    return json({ ok: false, error: "Could not read or write the pricing records." }, 500);
  }

  return json({ ok: false, error: 'action must be "get", "preview", "save", "history" or "revert_to".' }, 400);
}
