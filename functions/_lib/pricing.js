/**
 * Versioned pricing configuration (KV) and its validation.
 *
 *   pricing:v{n}       an IMMUTABLE snapshot: { version, created_at, products, commission_rate,
 *                      processor_fee_rate, delivery, pass_fee_on_delivery, rounding_step_ngn,
 *                      note, reverted_from? }. Written once, never changed or deleted: the
 *                      set of snapshots IS the change log.
 *   pricing:current    { version } the pointer to the snapshot in force. A save writes the
 *                      new snapshot FIRST and moves the pointer second, so the pointer can
 *                      never name a snapshot that doesn't exist yet.
 *
 * Nothing has been saved until the admin first saves: until then the built-in SEED (version 1,
 * today's real prices) is used for reads, and the first save persists it as v1 before writing v2.
 *
 * The public endpoint (api/pricing.js) exposes ONLY publicView(); the processor fee, target nets,
 * other costs and courier costs never leave the admin endpoint.
 *
 * Lives in functions/_lib/ and exports no onRequest* handler, so Pages does not route it.
 */
import math from "../../js/pricing-math.js";
import { getJson, listAll } from "./payouts.js";

const { round2, checkRates, breakdown, formatNgn, formatRate, STEPS } = math;

export const CURRENT_KEY = "pricing:current";
export const VERSION_PREFIX = "pricing:v";
export const versionKey = (n) => `${VERSION_PREFIX}${n}`;
export const LEGACY_COMMISSION_RATE = 0.08;   // records written before a rate was stored
export const MAX_PRICE_NGN = 10000000;
export const MAX_DELIVERY_NGN = 1000000;
export const MAX_NOTE = 200;

/** The catalogue is fixed (same ids as js/cart.js); only prices, targets and costs are editable. */
const CATALOGUE = {
  "ashe-honey-50cl": { name: "ASHE Honey", size: "50cl", price_ngn: 7000 },
  "ashe-honey-1l": { name: "ASHE Honey", size: "1 Litre", price_ngn: 13000 },
  "palm-oil-50cl": { name: "Palm Oil", size: "50cl", price_ngn: 700 },
  "palm-oil-1l": { name: "Palm Oil", size: "1 Litre", price_ngn: 1300 }
};
const SEED_COMMISSION = 0.08;
const SEED_FEE = 0.0215;

function buildSeed() {
  const products = {};
  for (const [id, p] of Object.entries(CATALOGUE)) {
    // Target net = what is kept at today's price, so the first screen shows no false warnings.
    const net = breakdown(p.price_ngn, { r: SEED_COMMISSION, f: SEED_FEE }).net_kept;
    products[id] = { name: p.name, size: p.size, price_ngn: p.price_ngn, target_net_ngn: net, other_cost_ngn: 0 };
  }
  return {
    version: 1,
    created_at: null,
    products,
    commission_rate: SEED_COMMISSION,
    processor_fee_rate: SEED_FEE,
    delivery: {
      lagos: { courier_cost_ngn: 1500, customer_charge_ngn: 1500 },
      other: { courier_cost_ngn: 3500, customer_charge_ngn: 3500 }
    },
    pass_fee_on_delivery: true,
    rounding_step_ngn: 10,
    note: "Initial values, carried over from the original site settings."
  };
}
export const SEED = buildSeed();
export const cloneConfig = (c) => JSON.parse(JSON.stringify(c));

/* ---------------- reading ---------------- */

export async function getSnapshot(kv, version) {
  if (!Number.isInteger(version) || version < 1) return null;
  const snap = await getJson(kv, versionKey(version));
  if (snap) return snap;
  return version === 1 ? cloneConfig(SEED) : null;   // v1 that was never persisted is the seed
}

/** { config, persisted }. Throws if the pointer names a snapshot that cannot be read. */
export async function loadCurrent(kv) {
  const pointer = await getJson(kv, CURRENT_KEY);
  if (!pointer || !Number.isInteger(pointer.version)) return { config: cloneConfig(SEED), persisted: false };
  const snap = await getJson(kv, versionKey(pointer.version));
  if (!snap) throw new Error(`pricing:v${pointer.version} is missing`);
  return { config: snap, persisted: true };
}

/** The rate shown to people ("earn 8%"). Display only: stored records keep their own rate. */
export async function currentCommissionRate(kv) {
  try {
    const { config } = await loadCurrent(kv);
    const r = Number(config.commission_rate);
    return Number.isFinite(r) ? r : LEGACY_COMMISSION_RATE;
  } catch (err) {
    return LEGACY_COMMISSION_RATE;
  }
}

/** When did this version stop being current? (the creation time of the next one), or null if it still is. */
export async function supersededAt(kv, version) {
  const next = await getJson(kv, versionKey(version + 1));
  return next && next.created_at ? next.created_at : null;
}

export function publicView(config) {
  return {
    version: config.version,
    products: Object.entries(config.products).map(([id, p]) => ({ id, name: p.name, size: p.size, price_ngn: p.price_ngn })),
    delivery: { lagos: config.delivery.lagos.customer_charge_ngn, other: config.delivery.other.customer_charge_ngn },
    commission_rate: config.commission_rate
  };
}

/* ---------------- validation ---------------- */

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const clean = (s, max) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The editable part of a config, in a fixed shape, for comparing and diffing. */
function editable(c) {
  const products = {};
  for (const [id, p] of Object.entries(c.products)) products[id] = { price_ngn: p.price_ngn, target_net_ngn: p.target_net_ngn, other_cost_ngn: p.other_cost_ngn || 0 };
  return {
    products,
    commission_rate: c.commission_rate,
    processor_fee_rate: c.processor_fee_rate,
    delivery: {
      lagos: { courier_cost_ngn: c.delivery.lagos.courier_cost_ngn, customer_charge_ngn: c.delivery.lagos.customer_charge_ngn },
      other: { courier_cost_ngn: c.delivery.other.courier_cost_ngn, customer_charge_ngn: c.delivery.other.customer_charge_ngn }
    },
    pass_fee_on_delivery: c.pass_fee_on_delivery,
    rounding_step_ngn: c.rounding_step_ngn
  };
}

/**
 * Applies `input` (a partial change) on top of `base` and validates the result.
 * Returns { ok: true, config } (version/created_at not yet set) or { ok: false, error }.
 */
export function validateSave(input, base) {
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to save." };
  const next = cloneConfig(base);
  delete next.reverted_from;
  delete next.changed_by;

  if (input.products !== undefined) {
    if (!input.products || typeof input.products !== "object" || Array.isArray(input.products)) return { ok: false, error: "products must be an object." };
    for (const [id, change] of Object.entries(input.products)) {
      if (!next.products[id]) return { ok: false, error: `Unknown product "${id}".` };
      if (!change || typeof change !== "object") return { ok: false, error: `Invalid change for ${id}.` };
      const label = `${next.products[id].name} ${next.products[id].size}`;
      if (change.price_ngn !== undefined) {
        if (!isNum(change.price_ngn) || !Number.isInteger(change.price_ngn) || change.price_ngn < 1 || change.price_ngn > MAX_PRICE_NGN) {
          return { ok: false, error: `The price of ${label} must be a whole number of naira between 1 and ${MAX_PRICE_NGN.toLocaleString("en-US")}.` };
        }
        next.products[id].price_ngn = change.price_ngn;
      }
      if (change.target_net_ngn !== undefined) {
        if (!isNum(change.target_net_ngn) || change.target_net_ngn <= 0 || change.target_net_ngn > MAX_PRICE_NGN) {
          return { ok: false, error: `The target net for ${label} must be a positive number.` };
        }
        next.products[id].target_net_ngn = round2(change.target_net_ngn);
      }
      if (change.other_cost_ngn !== undefined) {
        if (!isNum(change.other_cost_ngn) || change.other_cost_ngn < 0 || change.other_cost_ngn > MAX_PRICE_NGN) {
          return { ok: false, error: `The other cost per unit for ${label} must be zero or more.` };
        }
        next.products[id].other_cost_ngn = round2(change.other_cost_ngn);
      }
    }
  }

  for (const field of ["commission_rate", "processor_fee_rate"]) {
    if (input[field] !== undefined) {
      if (!isNum(input[field])) return { ok: false, error: `${field === "commission_rate" ? "The commission rate" : "The processor fee rate"} must be a number.` };
      next[field] = Math.round(input[field] * 1e6) / 1e6;
    }
  }
  const rateError = checkRates(next.commission_rate, next.processor_fee_rate);
  if (rateError) return { ok: false, error: rateError };

  if (input.delivery !== undefined) {
    if (!input.delivery || typeof input.delivery !== "object") return { ok: false, error: "delivery must be an object." };
    for (const zone of ["lagos", "other"]) {
      const change = input.delivery[zone];
      if (change === undefined) continue;
      const zoneLabel = zone === "lagos" ? "Lagos" : "other states";
      if (!change || typeof change !== "object") return { ok: false, error: `Invalid delivery change for ${zoneLabel}.` };
      if (change.courier_cost_ngn !== undefined) {
        if (!isNum(change.courier_cost_ngn) || change.courier_cost_ngn < 0 || change.courier_cost_ngn > MAX_DELIVERY_NGN) return { ok: false, error: `The courier cost for ${zoneLabel} must be zero or more (and under ${MAX_DELIVERY_NGN.toLocaleString("en-US")}).` };
        next.delivery[zone].courier_cost_ngn = round2(change.courier_cost_ngn);
      }
      if (change.customer_charge_ngn !== undefined) {
        if (!isNum(change.customer_charge_ngn) || !Number.isInteger(change.customer_charge_ngn) || change.customer_charge_ngn < 0 || change.customer_charge_ngn > MAX_DELIVERY_NGN) return { ok: false, error: `The delivery charge for ${zoneLabel} must be a whole number of naira, zero or more.` };
        next.delivery[zone].customer_charge_ngn = change.customer_charge_ngn;
      }
    }
  }
  if (input.pass_fee_on_delivery !== undefined) {
    if (typeof input.pass_fee_on_delivery !== "boolean") return { ok: false, error: "pass_fee_on_delivery must be true or false." };
    next.pass_fee_on_delivery = input.pass_fee_on_delivery;
  }
  if (input.rounding_step_ngn !== undefined) {
    if (!STEPS.includes(input.rounding_step_ngn)) return { ok: false, error: `The rounding step must be one of ${STEPS.join(", ")}.` };
    next.rounding_step_ngn = input.rounding_step_ngn;
  }

  if (JSON.stringify(editable(next)) === JSON.stringify(editable(base))) {
    return { ok: false, error: "Nothing has changed, so there is nothing to save." };
  }
  next.note = clean(input.note, MAX_NOTE);
  return { ok: true, config: next };
}

/* ---------------- change descriptions ---------------- */

const zoneName = (z) => (z === "lagos" ? "Lagos delivery" : "Other-states delivery");

/** Plain-words list of what differs between two snapshots. */
export function diffConfigs(prev, next) {
  const out = [];
  const a = editable(prev), b = editable(next);
  for (const id of Object.keys(b.products)) {
    const label = `${next.products[id].name} ${next.products[id].size}`;
    const pa = a.products[id] || {}, pb = b.products[id];
    if (pa.price_ngn !== pb.price_ngn) out.push(`${label} price ${formatNgn(pa.price_ngn)} → ${formatNgn(pb.price_ngn)}`);
    if (pa.target_net_ngn !== pb.target_net_ngn) out.push(`${label} target net ${formatNgn(pa.target_net_ngn)} → ${formatNgn(pb.target_net_ngn)}`);
    if ((pa.other_cost_ngn || 0) !== pb.other_cost_ngn) out.push(`${label} other cost ${formatNgn(pa.other_cost_ngn || 0)} → ${formatNgn(pb.other_cost_ngn)}`);
  }
  if (a.commission_rate !== b.commission_rate) out.push(`Commission rate ${formatRate(a.commission_rate)} → ${formatRate(b.commission_rate)}`);
  if (a.processor_fee_rate !== b.processor_fee_rate) out.push(`Processor fee rate ${formatRate(a.processor_fee_rate)} → ${formatRate(b.processor_fee_rate)}`);
  for (const z of ["lagos", "other"]) {
    if (a.delivery[z].courier_cost_ngn !== b.delivery[z].courier_cost_ngn) out.push(`${zoneName(z)} courier cost ${formatNgn(a.delivery[z].courier_cost_ngn)} → ${formatNgn(b.delivery[z].courier_cost_ngn)}`);
    if (a.delivery[z].customer_charge_ngn !== b.delivery[z].customer_charge_ngn) out.push(`${zoneName(z)} charge ${formatNgn(a.delivery[z].customer_charge_ngn)} → ${formatNgn(b.delivery[z].customer_charge_ngn)}`);
  }
  if (a.pass_fee_on_delivery !== b.pass_fee_on_delivery) out.push(`Fee on delivery ${a.pass_fee_on_delivery ? "passed to the customer" : "absorbed"} → ${b.pass_fee_on_delivery ? "passed to the customer" : "absorbed"}`);
  if (a.rounding_step_ngn !== b.rounding_step_ngn) out.push(`Rounding step ₦${a.rounding_step_ngn} → ₦${b.rounding_step_ngn}`);
  return out;
}

/* ---------------- writing and history ---------------- */

/**
 * Writes a new immutable snapshot and moves the pointer. `config` has no version yet.
 * The very first save persists the built-in seed as v1 so that history starts at the real beginning.
 */
export async function writeNewVersion(kv, config, createdAt) {
  const { config: current, persisted } = await loadCurrent(kv);
  if (!persisted) {
    const seed = cloneConfig(SEED);
    seed.created_at = createdAt;
    await kv.put(versionKey(1), JSON.stringify(seed), { metadata: { v: 1, at: createdAt } });
    await kv.put(CURRENT_KEY, JSON.stringify({ version: 1 }));
  }
  let next = (persisted ? current.version : 1) + 1;
  while (await kv.get(versionKey(next))) next++;           // never overwrite an existing snapshot
  const snapshot = { ...config, version: next, created_at: createdAt };
  await kv.put(versionKey(next), JSON.stringify(snapshot), { metadata: { v: next, at: createdAt } });   // snapshot first...
  await kv.put(CURRENT_KEY, JSON.stringify({ version: next }));                                          // ...then the pointer
  return snapshot;
}

/** Newest-first summaries with a plain-words list of changes against the previous version. */
export async function listVersions(kv, limit = 50) {
  const keys = await listAll(kv, VERSION_PREFIX);
  const numbers = keys.map((k) => /^pricing:v(\d+)$/.exec(k.name)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => b - a);
  if (!numbers.length) return [{ version: 1, created_at: null, note: SEED.note, changes: ["Built-in starting values (nothing saved yet)"], built_in: true }];
  const wanted = numbers.slice(0, limit + 1);
  const snaps = await Promise.all(wanted.map((n) => getJson(kv, versionKey(n))));
  const out = [];
  for (let i = 0; i < Math.min(limit, wanted.length); i++) {
    const snap = snaps[i];
    if (!snap) continue;
    const prev = snaps[i + 1];
    out.push({
      version: snap.version,
      created_at: snap.created_at,
      note: snap.note || "",
      reverted_from: snap.reverted_from || null,
      changed_by: snap.changed_by || null,
      changes: prev ? diffConfigs(prev, snap) : ["First saved version"]
    });
  }
  return out;
}
