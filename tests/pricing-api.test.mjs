/**
 * Tests for the pricing configuration: the public GET /api/pricing, the password-gated
 * POST /api/admin-pricing (get / preview / save / history / revert_to), validation,
 * versioning and history immutability.
 *
 *   node tests/pricing-api.test.mjs
 *
 * In-memory KV, no network, fake clock.
 */
import { onRequestGet as getPricing } from '../functions/api/pricing.js';
import { onRequestPost as adminPricing } from '../functions/api/admin-pricing.js';
import { SEED, publicView } from '../functions/_lib/pricing.js';

let NOW = Date.parse('2026-10-27T09:00:00.000Z');
Date.now = () => NOW;
const advance = (ms) => { NOW += ms; };

function makeKV() {
  const s = new Map();
  return { _s: s,
    async put(k, v, o = {}) { s.set(k, { value: v, metadata: o.metadata ?? null }); },
    async get(k) { return s.has(k) ? s.get(k).value : null; },
    async delete(k) { s.delete(k); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const all = [...s.keys()].filter((k) => k.startsWith(prefix)).sort();
      const st = cursor ? Number(cursor) : 0, sl = all.slice(st, st + limit), n = st + limit;
      return { keys: sl.map((name) => ({ name, metadata: s.get(name).metadata })), cursor: n < all.length ? String(n) : undefined, list_complete: n >= all.length }; } };
}
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, String(x).slice(0, 300))); };
const PW = 'admin-pw';
const KV = makeKV();
const env = { REFERRALS_KV: KV, ADMIN_REPORT_PASSWORD: PW };
const admin = async (body, e = env) => { const r = await adminPricing({ request: new Request('https://x/api/admin-pricing', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env: e }); return { status: r.status, cache: r.headers.get('Cache-Control'), j: await r.json() }; };
const pub = async (e = env) => { const r = await getPricing({ request: new Request('https://x/api/pricing'), env: e }); return { status: r.status, cache: r.headers.get('Cache-Control'), text: await r.text() }; };
const save = (change, extra = {}) => admin({ password: PW, action: 'save', ...change, ...extra });
const snap = (n) => KV._s.get('pricing:v' + n)?.value;

console.log('=== public GET /api/pricing ===');
let r = await pub();
let pj = JSON.parse(r.text);
check('200, ok, cacheable for 30 seconds', r.status === 200 && pj.ok === true && r.cache === 'public, max-age=30', r.cache);
check('before any save it serves today\'s real values (version 1)', pj.version === 1 && pj.commission_rate === 0.08 && pj.delivery.lagos === 1500 && pj.delivery.other === 3500 && pj.products.find((p) => p.id === 'ashe-honey-50cl').price_ngn === 7000 && pj.products.find((p) => p.id === 'palm-oil-1l').price_ngn === 1300, r.text);
check('four products, each with ONLY id, name, size, price_ngn', pj.products.length === 4 && pj.products.every((p) => JSON.stringify(Object.keys(p)) === JSON.stringify(['id', 'name', 'size', 'price_ngn'])));
check('top-level keys are exactly ok, version, products, delivery, commission_rate', JSON.stringify(Object.keys(pj).sort()) === JSON.stringify(['commission_rate', 'delivery', 'ok', 'products', 'version']));
check('delivery is the CUSTOMER charge only, as plain numbers', JSON.stringify(Object.keys(pj.delivery)) === JSON.stringify(['lagos', 'other']) && typeof pj.delivery.lagos === 'number');
for (const secret of ['processor', 'fee', 'target', 'courier', 'other_cost', '0.0215', '6289.5', 'note', 'pass_fee', 'rounding']) {
  check(`never mentions "${secret}"`, !r.text.toLowerCase().includes(secret.toLowerCase()), r.text);
}
check('nothing was written just by reading', KV._s.size === 0);
r = await pub({ ...env, REFERRALS_KV: undefined }); check('no KV bound -> 503, not cached', r.status === 503 && r.cache === 'no-store');
{
  const broken = makeKV(); await broken.put('pricing:current', JSON.stringify({ version: 9 }));
  r = await pub({ ...env, REFERRALS_KV: broken });
  check('a pointer naming a missing snapshot -> 503 and no price is guessed', r.status === 503 && r.cache === 'no-store' && JSON.parse(r.text).ok === false);
}

console.log('\n=== admin: access control ===');
r = await admin({ password: 'nope', action: 'get' }); check('wrong password -> 401', r.status === 401 && r.cache === 'no-store');
r = await admin({ action: 'get' }); check('no password -> 401', r.status === 401);
r = await admin({ password: PW, action: 'get' }, { ...env, ADMIN_REPORT_PASSWORD: undefined }); check('503 without ADMIN_REPORT_PASSWORD', r.status === 503);
r = await admin({ password: PW, action: 'get' }, { ...env, REFERRALS_KV: undefined }); check('503 without KV', r.status === 503);
r = await admin('not json'); check('invalid JSON -> 400', r.status === 400);
r = await admin('null'); check('non-object body -> 400', r.status === 400);
r = await admin({ password: PW, action: 'explode' }); check('unknown action -> 400', r.status === 400 && /action must be/.test(r.j.error));
r = await admin({ password: PW }); check('missing action -> 400', r.status === 400);
r = await admin({ password: PW, action: 'get' }); check('every admin response is no-store', r.cache === 'no-store');
check('a wrong password changes nothing', KV._s.size === 0);

console.log('\n=== admin: get ===');
r = await admin({ password: PW, action: 'get' });
check('returns the full private config, not yet persisted', r.status === 200 && r.j.ok && r.j.persisted === false && r.j.config.version === 1 && r.j.config.processor_fee_rate === 0.0215 && r.j.config.products['ashe-honey-50cl'].target_net_ngn === 6289.5 && r.j.config.delivery.lagos.courier_cost_ngn === 1500 && r.j.config.pass_fee_on_delivery === true && r.j.config.rounding_step_ngn === 10, JSON.stringify(r.j).slice(0, 200));
check('seed: today\'s four prices, 8%, fee 2.15%, delivery 1,500 / 3,500 (courier costs equal to them)', ['ashe-honey-50cl', 'ashe-honey-1l', 'palm-oil-50cl', 'palm-oil-1l'].map((id) => r.j.config.products[id].price_ngn).join() === '7000,13000,700,1300' && r.j.config.commission_rate === 0.08 && r.j.config.delivery.lagos.customer_charge_ngn === 1500 && r.j.config.delivery.other.customer_charge_ngn === 3500 && r.j.config.delivery.other.courier_cost_ngn === 3500);
check('the history shows the built-in starting values', r.j.versions.length === 1 && r.j.versions[0].built_in === true);

console.log('\n=== admin: save validation (nothing is written for any of these) ===');
const bad = async (label, change, re) => { const before = KV._s.size; const rr = await save(change); check(`${label} -> 400${re ? ' "' + re + '"' : ''}`, rr.status === 400 && rr.j.ok === false && (!re || new RegExp(re, 'i').test(rr.j.error)) && KV._s.size === before, JSON.stringify(rr.j)); };
await bad('price 0', { products: { 'palm-oil-50cl': { price_ngn: 0 } } }, 'whole number');
await bad('negative price', { products: { 'palm-oil-50cl': { price_ngn: -5 } } });
await bad('fractional price', { products: { 'palm-oil-50cl': { price_ngn: 700.5 } } });
await bad('absurd price (over the cap)', { products: { 'palm-oil-50cl': { price_ngn: 10000001 } } });
await bad('price as a string', { products: { 'palm-oil-50cl': { price_ngn: '800' } } });
await bad('price NaN (arrives as null)', { products: { 'palm-oil-50cl': { price_ngn: NaN } } });
await bad('price Infinity', { products: { 'palm-oil-50cl': { price_ngn: Infinity } } });
await bad('unknown product', { products: { 'goat-milk': { price_ngn: 500 } } }, 'Unknown product');
await bad('products not an object', { products: [1, 2] });
await bad('target net zero', { products: { 'palm-oil-50cl': { target_net_ngn: 0 } } }, 'target net');
await bad('target net negative', { products: { 'palm-oil-50cl': { target_net_ngn: -1 } } });
await bad('other cost negative', { products: { 'palm-oil-50cl': { other_cost_ngn: -1 } } }, 'other cost');
await bad('commission over 50%', { commission_rate: 0.6 }, 'between 0% and 50%');
await bad('commission negative', { commission_rate: -0.01 });
await bad('commission NaN', { commission_rate: NaN });
await bad('commission as a string', { commission_rate: '0.1' }, 'must be a number');
await bad('fee over 50%', { processor_fee_rate: 0.51 });
await bad('commission + fee = 90%', { commission_rate: 0.5, processor_fee_rate: 0.4 }, 'under 90%');
await bad('commission + fee over 90%', { commission_rate: 0.5, processor_fee_rate: 0.45 }, 'under 90%');
await bad('a rate pair that is only wrong in combination with the saved value', { commission_rate: 0.5, processor_fee_rate: 0.4 });
await bad('negative courier cost', { delivery: { lagos: { courier_cost_ngn: -1 } } }, 'courier cost');
await bad('absurd courier cost', { delivery: { lagos: { courier_cost_ngn: 1e9 } } });
await bad('negative delivery charge', { delivery: { other: { customer_charge_ngn: -100 } } }, 'delivery charge');
await bad('fractional delivery charge', { delivery: { other: { customer_charge_ngn: 99.5 } } });
await bad('delivery charge NaN', { delivery: { other: { customer_charge_ngn: NaN } } });
await bad('delivery not an object', { delivery: 5 });
await bad('rounding step 7', { rounding_step_ngn: 7 }, 'rounding step');
await bad('pass_fee as a string', { pass_fee_on_delivery: 'yes' });
await bad('no change at all', { note: 'nothing' }, 'Nothing has changed');
await bad('re-sending the current values is "no change" too', { commission_rate: 0.08, products: { 'palm-oil-50cl': { price_ngn: 700 } } }, 'Nothing has changed');
await bad('an empty save', {}, 'Nothing has changed');
r = await admin({ password: PW, action: 'save', products: { 'palm-oil-50cl': { price_ngn: 750 } }, bogus_field: 1 });
check('unknown top-level fields are ignored, not stored', r.status === 200 && !('bogus_field' in JSON.parse(snap(2))));

console.log('\n=== admin: save writes a NEW immutable version ===');
r = await admin({ password: PW, action: 'get' });
const v1raw = snap(1), v2raw = snap(2);
check('the first save persisted the built-in seed as v1, then wrote v2 (the pointer moved to 2)', !!v1raw && !!v2raw && JSON.parse(KV._s.get('pricing:current').value).version === 2 && r.j.config.version === 2 && r.j.persisted === true);
check('v1 is the original values, with a created_at', JSON.parse(v1raw).products['palm-oil-50cl'].price_ngn === 700 && JSON.parse(v1raw).version === 1 && !!JSON.parse(v1raw).created_at);
check('v2 carries the change, its version, created_at and note', JSON.parse(v2raw).products['palm-oil-50cl'].price_ngn === 750 && JSON.parse(v2raw).version === 2 && JSON.parse(v2raw).created_at === new Date(NOW).toISOString());
advance(60e3);
r = await save({ products: { 'ashe-honey-50cl': { price_ngn: 7500, target_net_ngn: 6400 } }, commission_rate: 0.1, note: '  Honey up   after the harvest  ' });
check('a second save -> version 3 with a plain-words list of changes', r.status === 200 && r.j.version === 3 && r.j.changes.includes('ASHE Honey 50cl price ₦7,000 → ₦7,500') && r.j.changes.includes('ASHE Honey 50cl target net ₦6,289.50 → ₦6,400') && r.j.changes.includes('Commission rate 8% → 10%'), JSON.stringify(r.j.changes));
check('the note is trimmed and whitespace collapsed', JSON.parse(snap(3)).note === 'Honey up after the harvest');
check('IMMUTABLE: v1 and v2 are byte-for-byte what they were', snap(1) === v1raw && snap(2) === v2raw);
check('fields left out keep their value (the palm oil 750 from v2 is still there)', JSON.parse(snap(3)).products['palm-oil-50cl'].price_ngn === 750 && JSON.parse(snap(3)).processor_fee_rate === 0.0215);
r = await save({ note: 'x'.repeat(500), processor_fee_rate: 0.03 });
check('the note is capped at 200 characters', JSON.parse(snap(4)).note.length === 200);
r = await save({ delivery: { lagos: { courier_cost_ngn: 1800.5, customer_charge_ngn: 1850 } }, pass_fee_on_delivery: false, rounding_step_ngn: 50, products: { 'palm-oil-1l': { other_cost_ngn: 25.555 } } });
check('delivery, fee-pass-through, step and other cost are all saved (kobo-rounded)', (c => c.delivery.lagos.courier_cost_ngn === 1800.5 && c.delivery.lagos.customer_charge_ngn === 1850 && c.pass_fee_on_delivery === false && c.rounding_step_ngn === 50 && c.products['palm-oil-1l'].other_cost_ngn === 25.56)(JSON.parse(snap(5))), snap(5));
check('names and sizes are not editable and carry through', JSON.parse(snap(5)).products['palm-oil-1l'].name === 'Palm Oil' && JSON.parse(snap(5)).products['palm-oil-1l'].size === '1 Litre');

console.log('\n=== the public endpoint follows the pointer (and still shows only public fields) ===');
r = await pub(); pj = JSON.parse(r.text);
check('shows version 5, the current prices, the current charges and the current rate', pj.version === 5 && pj.products.find((p) => p.id === 'ashe-honey-50cl').price_ngn === 7500 && pj.products.find((p) => p.id === 'palm-oil-50cl').price_ngn === 750 && pj.delivery.lagos === 1850 && pj.commission_rate === 0.1, r.text);
check('and still nothing private after changing private settings', !/processor|fee|target|courier|other_cost|rounding|0\.03/i.test(r.text), r.text);

console.log('\n=== optimistic concurrency ===');
const countBefore = [...KV._s.keys()].filter((k) => /^pricing:v/.test(k)).length;
r = await save({ commission_rate: 0.09 }, { expected_version: 4 });
check('saving from a stale page -> 409 with the current version, and nothing is written', r.status === 409 && r.j.conflict === true && r.j.current_version === 5 && [...KV._s.keys()].filter((k) => /^pricing:v/.test(k)).length === countBefore, JSON.stringify(r.j));
r = await save({ commission_rate: 0.09 }, { expected_version: 5 });
check('saving with the right expected_version works (version 6)', r.status === 200 && r.j.version === 6);

console.log('\n=== preview: shows what would change, writes nothing ===');
const keysBeforePreview = [...KV._s.keys()].length;
r = await admin({ password: PW, action: 'preview', products: { 'palm-oil-1l': { price_ngn: 1400 } } });
check('lists the changes and writes nothing', r.status === 200 && r.j.ok && r.j.changes.join() === 'Palm Oil 1 Litre price ₦1,300 → ₦1,400' && [...KV._s.keys()].length === keysBeforePreview, JSON.stringify(r.j));
r = await admin({ password: PW, action: 'preview', commission_rate: 0.7 }); check('preview applies the same validation', r.status === 400 && /between 0% and 50%/.test(r.j.error));
r = await admin({ password: PW, action: 'preview', note: 'x' }); check('preview of "no change" says so', r.status === 400 && /Nothing has changed/.test(r.j.error));

console.log('\n=== revert_to creates a NEW version; nothing is deleted ===');
const keysBeforeRevert = [...KV._s.keys()].filter((k) => /^pricing:v/.test(k));
const raws = Object.fromEntries(keysBeforeRevert.map((k) => [k, KV._s.get(k).value]));
r = await admin({ password: PW, action: 'revert_to', version: 1 });
check('revert to v1 -> version 7, a copy of v1, marked reverted_from 1', r.status === 200 && r.j.version === 7 && r.j.reverted_from === 1 && JSON.parse(snap(7)).reverted_from === 1 && JSON.parse(snap(7)).note === 'Reverted to version 1', JSON.stringify(r.j).slice(0, 200));
const v7 = JSON.parse(snap(7)), v1 = JSON.parse(v1raw);
check('v7 holds v1\'s prices, rates and delivery exactly', v7.products['palm-oil-50cl'].price_ngn === 700 && v7.products['ashe-honey-50cl'].price_ngn === 7000 && v7.commission_rate === 0.08 && v7.processor_fee_rate === 0.0215 && v7.delivery.lagos.customer_charge_ngn === 1500 && v7.pass_fee_on_delivery === true && v7.rounding_step_ngn === 10 && v7.products['palm-oil-1l'].other_cost_ngn === 0);
check('NOTHING deleted or changed: every earlier snapshot is byte-for-byte intact', Object.entries(raws).every(([k, v]) => KV._s.get(k)?.value === v) && [...KV._s.keys()].filter((k) => /^pricing:v/.test(k)).length === keysBeforeRevert.length + 1);
check('the pointer moved to 7 and the public prices are v1\'s again', JSON.parse(KV._s.get('pricing:current').value).version === 7 && JSON.parse((await pub()).text).products.find((p) => p.id === 'palm-oil-50cl').price_ngn === 700);
r = await admin({ password: PW, action: 'revert_to', version: 7 }); check('reverting to what is already live -> 400, nothing written', r.status === 400 && /identical/.test(r.j.error) && !KV._s.has('pricing:v8'));
r = await admin({ password: PW, action: 'revert_to', version: 99 }); check('unknown version -> 404', r.status === 404);
for (const v of ['3', 1.5, null, undefined, -1, 0]) { r = await admin({ password: PW, action: 'revert_to', version: v }); check(`revert_to version ${JSON.stringify(v)} -> 400/404, nothing written`, (r.status === 400 || r.status === 404) && !KV._s.has('pricing:v8')); }
r = await admin({ password: PW, action: 'revert_to', version: 3, expected_version: 2 }); check('revert from a stale page -> 409', r.status === 409);
r = await admin({ password: PW, action: 'revert_to', version: 3, note: 'Back to the harvest prices' });
check('a revert can carry its own note', r.status === 200 && JSON.parse(snap(8)).note === 'Back to the harvest prices' && JSON.parse(snap(8)).products['ashe-honey-50cl'].price_ngn === 7500);

console.log('\n=== history ===');
r = await admin({ password: PW, action: 'history' });
check('newest first, each with date, note and changes', r.j.versions[0].version === 8 && r.j.versions[0].reverted_from === 3 && r.j.versions.every((v, i, a) => i === 0 || a[i - 1].version > v.version) && r.j.versions.at(-1).version === 1, JSON.stringify(r.j.versions.map((v) => v.version)));
check('v3\'s entry describes its changes', r.j.versions.find((v) => v.version === 3).changes.includes('Commission rate 8% → 10%') && r.j.versions.find((v) => v.version === 3).note === 'Honey up after the harvest');
check('v1 reads as the first saved version', r.j.versions.find((v) => v.version === 1).changes.join() === 'First saved version');
r = await admin({ password: PW, action: 'history', version: 3 });
check('one full snapshot on request', r.status === 200 && r.j.config.version === 3 && r.j.config.commission_rate === 0.1);
r = await admin({ password: PW, action: 'history', version: 999 }); check('unknown snapshot -> 404', r.status === 404);
r = await admin({ password: PW, action: 'history', version: 'x' }); check('bad version -> 400', r.status === 400);
for (let i = 0; i < 52; i++) await save({ products: { 'palm-oil-50cl': { price_ngn: 800 + i } }, note: 'bulk ' + i });
r = await admin({ password: PW, action: 'history' });
check(`only the last 50 versions are listed (${[...KV._s.keys()].filter((k) => /^pricing:v/.test(k)).length} exist)`, r.j.versions.length === 50 && r.j.versions[0].version === 60 && r.j.versions[49].version === 11, r.j.versions.length);
r = await admin({ password: PW, action: 'get' }); check('get returns the same last 50', r.j.versions.length === 50 && r.j.config.version === 60);
r = await admin({ password: PW, action: 'history', limit: 5 }); check('a smaller limit is honoured', r.j.versions.length === 5);
check('all 60 snapshots still exist: history is never trimmed in storage', [...KV._s.keys()].filter((k) => /^pricing:v/.test(k)).length === 60 && Object.entries(raws).every(([k, v]) => KV._s.get(k)?.value === v));

console.log('\n=== a snapshot is never overwritten, even if the pointer is stale ===');
{
  const k2 = makeKV(); const e2 = { ...env, REFERRALS_KV: k2 };
  await adminPricing({ request: new Request('https://x', { method: 'POST', body: JSON.stringify({ password: PW, action: 'save', commission_rate: 0.09 }) }), env: e2 });   // v1 + v2
  await k2.put('pricing:v3', JSON.stringify({ version: 3, marker: 'someone else wrote this' }));                                                                                      // a snapshot the pointer doesn't know about
  const res = await adminPricing({ request: new Request('https://x', { method: 'POST', body: JSON.stringify({ password: PW, action: 'save', commission_rate: 0.11 }) }), env: e2 });
  const jj = await res.json();
  check('the save skips the occupied v3 and writes v4; v3 is untouched', jj.version === 4 && JSON.parse(k2._s.get('pricing:v3').value).marker === 'someone else wrote this');
}

console.log('\n=== publicView never carries private fields, whatever the config holds ===');
{
  const cfg = JSON.parse(JSON.stringify(SEED)); cfg.processor_fee_rate = 0.0999; cfg.products['palm-oil-50cl'].target_net_ngn = 123456.78; cfg.delivery.lagos.courier_cost_ngn = 4242.42; cfg.note = 'SECRET NOTE';
  const text = JSON.stringify(publicView(cfg));
  check('a config with distinctive private values leaks none of them', !/0\.0999|123456|4242|SECRET/.test(text), text);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
