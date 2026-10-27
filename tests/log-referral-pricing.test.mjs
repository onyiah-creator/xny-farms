/**
 * Tests for commission recorded against the price in force: versioned commission,
 * browser-total mismatch flagging, the legacy fallback, and the guarantee that later
 * price or rate changes never alter what was already recorded, reported or shown to affiliates.
 *
 *   node tests/log-referral-pricing.test.mjs
 */
import { onRequestPost as logReferral } from '../functions/api/log-referral.js';
import { onRequestPost as adminPricing } from '../functions/api/admin-pricing.js';
import { onRequestPost as getReferrals } from '../functions/api/get-referrals.js';
import { onRequestGet as myStats } from '../functions/api/get-my-stats.js';
import { onRequestPost as sendEmail, buildWelcomeEmail } from '../functions/api/send-affiliate-email.js';

let NOW = Date.parse('2026-10-27T09:00:00.000Z');
Date.now = () => NOW;
const advance = (ms) => { NOW += ms; };
const HOUR = 3600e3;

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
const env = { REFERRALS_KV: KV, ADMIN_REPORT_PASSWORD: PW, RESEND_API_KEY: 're_test' };
let mails = [];
globalThis.fetch = async (url, init) => { mails.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 're_' + mails.length }), { status: 200 }); };
const body = (b) => new Request('https://x/api', { method: 'POST', body: JSON.stringify(b) });
const log = async (b) => { const r = await logReferral({ request: body({ ref_code: 'ada01', ...b }), env }); return { status: r.status, j: await r.json() }; };
const adm = async (b) => { const r = await adminPricing({ request: body({ password: PW, ...b }), env }); return { status: r.status, j: await r.json() }; };
const report = async (extra = {}) => (await getReferrals({ request: body({ password: PW, ...extra }), env })).json();
const stats = async (code = 'ADA01') => (await myStats({ request: new Request('https://x/api/get-my-stats?code=' + code), env })).json();
const rec = (tx) => JSON.parse(KV._s.get(`referral:ADA01:${tx}`).value);
const meta = (tx) => KV._s.get(`referral:ADA01:${tx}`).metadata;

await KV.put('affiliate:ADA01', JSON.stringify({ name: 'Ada Eze', email: 'ada@example.com', approved_at: '2026-01-01T00:00:00.000Z', status: 'active' }), { metadata: { n: 'Ada Eze', e: 'ada@example.com', at: '2026-01-01T00:00:00.000Z', s: 'active' } });
const ITEMS = [{ id: 'ashe-honey-50cl', qty: 2 }, { id: 'palm-oil-50cl', qty: 1 }];   // 2 x 7,000 + 700 = 14,700 at v1

console.log('=== a versioned order is priced by the SERVER from the snapshot ===');
let r = await log({ tx_ref: 'a1', order_total_ngn: 14700, pricing_version: 1, items: ITEMS });
check('logged; commission = 8% x 14,700 = 1,176', r.status === 200 && r.j.logged === true && r.j.commission_ngn === 1176 && r.j.pricing_version === 1 && r.j.legacy === false && r.j.price_mismatch === false, JSON.stringify(r.j));
let a1 = rec('a1');
check('the record stores pricing_version, items (with the prices used), commission_rate, commission_ngn and order_total_ngn',
  a1.pricing_version === 1 && a1.commission_rate === 0.08 && a1.commission_ngn === 1176 && a1.order_total_ngn === 14700 && JSON.stringify(a1.items) === JSON.stringify([{ id: 'ashe-honey-50cl', qty: 2, price_ngn: 7000 }, { id: 'palm-oil-50cl', qty: 1, price_ngn: 700 }]), JSON.stringify(a1));
check('not flagged: no price_mismatch, no legacy', !('price_mismatch' in a1) && !('legacy' in a1));
check('metadata carries the short figures plus rate and version', JSON.stringify(Object.keys(meta('a1')).sort()) === JSON.stringify(['c', 'm', 'r', 't', 'ts', 'v']) && meta('a1').r === 0.08 && meta('a1').v === 1 && meta('a1').m === 1176);
r = await log({ tx_ref: 'a2', order_total_ngn: 14700.5, pricing_version: 1, items: ITEMS });
check('a browser total within N1 of the server\'s is not a mismatch', r.j.price_mismatch === false && !('price_mismatch' in rec('a2')) && rec('a2').order_total_ngn === 14700);
r = await log({ tx_ref: 'a3', order_total_ngn: 14698.9, pricing_version: 1, items: ITEMS });
check('just over N1 off IS a mismatch', r.j.price_mismatch === true);

console.log('\n=== the browser cannot talk the commission up or down ===');
r = await log({ tx_ref: 'm1', order_total_ngn: 1000000, pricing_version: 1, items: ITEMS });
check('a tampered (inflated) total: the SERVER amount is credited, the record is flagged price_mismatch and keeps what the browser claimed',
  r.j.logged && rec('m1').order_total_ngn === 14700 && rec('m1').commission_ngn === 1176 && rec('m1').price_mismatch === true && rec('m1').browser_order_total_ngn === 1000000 && meta('m1').pm === 1, JSON.stringify(rec('m1')));
r = await log({ tx_ref: 'm2', order_total_ngn: 100, pricing_version: 1, items: ITEMS });
check('a deflated total is also corrected to the server amount and flagged', rec('m2').order_total_ngn === 14700 && rec('m2').price_mismatch === true);
r = await log({ tx_ref: 'm3', pricing_version: 1, items: ITEMS });
check('with valid items the browser total may be absent: the server amount is used, no mismatch', r.status === 200 && rec('m3').order_total_ngn === 14700 && !('price_mismatch' in rec('m3')));
r = await log({ tx_ref: 'm4', order_total_ngn: 'lots', pricing_version: 1, items: ITEMS });
check('...or garbage: still the server amount', r.status === 200 && rec('m4').order_total_ngn === 14700);
r = await log({ tx_ref: 'm5', order_total_ngn: 14700, pricing_version: 1, items: [{ id: 'ashe-honey-50cl', qty: 1 }, { id: 'ashe-honey-50cl', qty: 1 }, { id: 'palm-oil-50cl', qty: 1 }] });
check('the same product on two lines is added up', rec('m5').order_total_ngn === 14700 && rec('m5').items.length === 2 && rec('m5').items[0].qty === 2);

console.log('\n=== prices and the rate change: new orders use the new ones, old versions are honoured for 24 hours ===');
await adm({ action: 'save', products: { 'ashe-honey-50cl': { price_ngn: 8000 } }, commission_rate: 0.1, note: 'Honey up, commission up' });   // v1 persisted, v2 live
advance(60e3);
r = await log({ tx_ref: 'b1', order_total_ngn: 16700, pricing_version: 2, items: ITEMS });
check('v2 order: 2 x 8,000 + 700 = 16,700, commission 10% = 1,670, stored with rate 0.1 and version 2', r.j.logged && rec('b1').order_total_ngn === 16700 && rec('b1').commission_ngn === 1670 && rec('b1').commission_rate === 0.1 && rec('b1').pricing_version === 2);
r = await log({ tx_ref: 'b2', order_total_ngn: 14700, pricing_version: 1, items: ITEMS });
check('a customer who started checkout under v1 is still priced as shown (v1 was replaced a minute ago): 14,700 x 8%', rec('b2').order_total_ngn === 14700 && rec('b2').commission_ngn === 1176 && rec('b2').commission_rate === 0.08 && rec('b2').pricing_version === 1 && !rec('b2').legacy, JSON.stringify(rec('b2')));
advance(23 * HOUR);
r = await log({ tx_ref: 'b3', order_total_ngn: 14700, pricing_version: 1, items: ITEMS });
check('still honoured 23 hours after it was replaced', rec('b3').pricing_version === 1 && !rec('b3').legacy);
advance(2 * HOUR);
r = await log({ tx_ref: 'b4', order_total_ngn: 14700, pricing_version: 1, items: ITEMS });
check('25 hours after it was replaced, v1 is no longer trusted: legacy, priced at the rate in force NOW (10%)', rec('b4').legacy === true && rec('b4').pricing_version === null && rec('b4').commission_rate === 0.1 && rec('b4').commission_ngn === 1470, JSON.stringify(rec('b4')));

console.log('\n=== legacy fallback: old cached JavaScript, unknown versions, bad items ===');
const legacyCase = async (label, extra, tx) => {
  const rr = await log({ tx_ref: tx, order_total_ngn: 1000, ...extra });
  const rc = rec(tx);
  check(`${label}: logged as legacy, browser subtotal x the rate in force (10%) = 100`, rr.status === 200 && rr.j.logged && rc.legacy === true && rc.order_total_ngn === 1000 && rc.commission_ngn === 100 && rc.commission_rate === 0.1 && rc.pricing_version === null && meta(tx).lg === 1 && !('v' in meta(tx)), JSON.stringify(rc));
};
await legacyCase('no version or items (an old cached site)', {}, 'l1');
await legacyCase('items but no version', { items: ITEMS }, 'l2');
await legacyCase('version but no items', { pricing_version: 2 }, 'l3');
await legacyCase('an unknown version (999)', { pricing_version: 999, items: ITEMS }, 'l4');
await legacyCase('version 0', { pricing_version: 0, items: ITEMS }, 'l5');
await legacyCase('version as a string', { pricing_version: '2', items: ITEMS }, 'l6');
await legacyCase('version null', { pricing_version: null, items: ITEMS }, 'l7');
await legacyCase('an empty items list', { pricing_version: 2, items: [] }, 'l8');
await legacyCase('items that are not a list', { pricing_version: 2, items: 'ashe' }, 'l9');
await legacyCase('quantity 0', { pricing_version: 2, items: [{ id: 'palm-oil-50cl', qty: 0 }] }, 'l10');
await legacyCase('a fractional quantity', { pricing_version: 2, items: [{ id: 'palm-oil-50cl', qty: 1.5 }] }, 'l11');
await legacyCase('a negative quantity', { pricing_version: 2, items: [{ id: 'palm-oil-50cl', qty: -3 }] }, 'l12');
await legacyCase('an absurd quantity', { pricing_version: 2, items: [{ id: 'palm-oil-50cl', qty: 1001 }] }, 'l13');
await legacyCase('an unknown product id', { pricing_version: 2, items: [{ id: 'goat-milk', qty: 1 }] }, 'l14');
await legacyCase('too many lines', { pricing_version: 2, items: Array.from({ length: 21 }, () => ({ id: 'palm-oil-50cl', qty: 1 })) }, 'l15');
await legacyCase('a malformed line', { pricing_version: 2, items: [null] }, 'l16');
r = await log({ tx_ref: 'l17', pricing_version: 2, items: [{ id: 'nope', qty: 1 }] });
check('legacy AND no usable browser total -> 400, as before', r.status === 400 && !KV._s.has('referral:ADA01:l17'));
r = await log({ tx_ref: 'l18', order_total_ngn: 0 });
check('a zero total with no items -> 400, as before', r.status === 400);
{
  const bare = makeKV(); await bare.put('affiliate:ADA01', JSON.stringify({ name: 'A', email: 'a@example.com', approved_at: 'x' }));
  const rr = await logReferral({ request: body({ ref_code: 'ada01', tx_ref: 'bare1', order_total_ngn: 1000 }), env: { ...env, REFERRALS_KV: bare } }); const jj = await rr.json();
  check('with nothing ever saved, the legacy rate is today\'s 8%', jj.logged && JSON.parse(bare._s.get('referral:ADA01:bare1').value).commission_rate === 0.08 && jj.commission_ngn === 80);
  const rv = await logReferral({ request: body({ ref_code: 'ada01', tx_ref: 'bare2', order_total_ngn: 14700, pricing_version: 1, items: ITEMS }), env: { ...env, REFERRALS_KV: bare } }); const jv = await rv.json();
  check('and version 1 works before anything is saved (the built-in v1 is the real v1)', jv.logged && jv.pricing_version === 1 && jv.commission_ngn === 1176 && !jv.legacy);
}
check('suspended affiliates still earn nothing', await (async () => { const k = makeKV(); await k.put('affiliate:PAUSED1', JSON.stringify({ status: 'suspended' })); const rr = await logReferral({ request: body({ ref_code: 'paused1', tx_ref: 's1', order_total_ngn: 100, pricing_version: 1, items: ITEMS }), env: { ...env, REFERRALS_KV: k } }); return (await rr.json()).logged === false; })());
check('an unknown code earns nothing', (await log({ ref_code: 'nobody', tx_ref: 'u1', pricing_version: 1, items: ITEMS })).j.logged === false && !KV._s.has('referral:NOBODY:u1'));

console.log('\n=== history is immutable: changing prices and the rate never touches what was recorded ===');
{
  const k = makeKV(); const e = { ...env, REFERRALS_KV: k };
  const L = async (b) => (await logReferral({ request: body({ ref_code: 'zed01', ...b }), env: e })).json();
  const A = async (b) => (await adminPricing({ request: body({ password: PW, ...b }), env: e })).json();
  const REP = async (x = {}) => (await getReferrals({ request: body({ password: PW, ...x }), env: e })).json();
  const ST = async () => (await myStats({ request: new Request('https://x/api/get-my-stats?code=ZED01'), env: e })).json();
  await k.put('affiliate:ZED01', JSON.stringify({ name: 'Zed Zee', email: 'zed@example.com', approved_at: '2026-01-01T00:00:00.000Z' }), { metadata: { n: 'Zed Zee', e: 'zed@example.com', at: '2026-01-01T00:00:00.000Z' } });
  await L({ tx_ref: 'h1', order_total_ngn: 14700, pricing_version: 1, items: ITEMS });                     // 14,700 @ 8% = 1,176
  const before = { rec: k._s.get('referral:ZED01:h1').value, meta: JSON.stringify(k._s.get('referral:ZED01:h1').metadata), rep: await REP(), det: await REP({ code: 'ZED01' }), st: await ST() };
  check('(baseline) earned 1,176 on 14,700', before.st.commission_ngn === 1176 && before.st.total_sales_ngn === 14700 && before.rep.rows.find((x) => x.code === 'ZED01').commission_earned_ngn === 1176);
  advance(60e3);
  await A({ action: 'save', products: { 'ashe-honey-50cl': { price_ngn: 9999 }, 'palm-oil-50cl': { price_ngn: 999 } }, commission_rate: 0.2, note: 'Big change' });
  advance(60e3);
  await A({ action: 'save', commission_rate: 0.05, processor_fee_rate: 0.04, delivery: { lagos: { customer_charge_ngn: 9000 } }, note: 'And another' });
  const after = { rec: k._s.get('referral:ZED01:h1').value, meta: JSON.stringify(k._s.get('referral:ZED01:h1').metadata), rep: await REP(), det: await REP({ code: 'ZED01' }), st: await ST() };
  check('the earlier ORDER RECORD and its metadata are byte-for-byte unchanged', after.rec === before.rec && after.meta === before.meta);
  check('the REPORT row for that affiliate (orders, sales, earned, balance) is unchanged', JSON.stringify(after.rep.rows.find((x) => x.code === 'ZED01')) === JSON.stringify(before.rep.rows.find((x) => x.code === 'ZED01')) && JSON.stringify(after.rep.totals) === JSON.stringify(before.rep.totals));
  check('the order detail still shows its own rate (8%) and version (1)', after.det.orders_detail[0].commission_rate === 0.08 && after.det.orders_detail[0].pricing_version === 1 && after.det.orders_detail[0].commission_ngn === 1176 && after.det.orders_detail[0].order_total_ngn === 14700);
  check('the AFFILIATE\'S stats are unchanged (earned and sales), though the displayed rate is the new current one', after.st.commission_ngn === before.st.commission_ngn && after.st.total_sales_ngn === before.st.total_sales_ngn && after.st.orders === 1 && after.st.balance_due_ngn === before.st.balance_due_ngn);
  check('display-only: both endpoints now show the CURRENT rate (5%)', after.st.commission_rate === 0.05 && after.rep.commission_rate === 0.05 && before.st.commission_rate === 0.08, [after.st.commission_rate, after.rep.commission_rate].join());
  const lg = await L({ tx_ref: 'h2', order_total_ngn: 1000, pricing_version: 3, items: [{ id: 'palm-oil-50cl', qty: 1 }] });
  check('a NEW order is recorded at the new price and rate: 999 x 5% = 49.95', lg.logged && JSON.parse(k._s.get('referral:ZED01:h2').value).order_total_ngn === 999 && JSON.parse(k._s.get('referral:ZED01:h2').value).commission_ngn === 49.95 && JSON.parse(k._s.get('referral:ZED01:h2').value).commission_rate === 0.05);
  const st2 = await ST();
  check('totals are the OLD order at its rate plus the NEW order at its rate: 1,176 + 49.95', st2.commission_ngn === 1225.95 && st2.total_sales_ngn === 15699 && st2.orders === 2, JSON.stringify(st2));
  const rp2 = (await REP()).rows.find((x) => x.code === 'ZED01');
  check('and the report agrees (earned 1,225.95)', rp2.commission_earned_ngn === 1225.95 && rp2.total_sales_ngn === 15699);
  await A({ action: 'revert_to', version: 1 });
  check('even reverting the pricing back to v1 changes no earlier record', k._s.get('referral:ZED01:h1').value === before.rec && (await ST()).commission_ngn === 1225.95);
}

console.log('\n=== legacy records (written before a rate was stored) keep working, at THEIR rate ===');
{
  const k = makeKV(); const e = { ...env, REFERRALS_KV: k };
  await k.put('affiliate:OLD01', JSON.stringify({ name: 'Old Timer', email: 'old@example.com', approved_at: 'x' }), { metadata: { n: 'Old Timer', e: 'old@example.com', at: 'x' } });
  await adminPricing({ request: body({ password: PW, action: 'save', commission_rate: 0.15 }), env: e });   // the rate in force today is 15%
  // oldest style: value only, no commission, no rate, no metadata -> falls back to the original 8%
  await k.put('referral:OLD01:o1', JSON.stringify({ ref_code: 'OLD01', tx_ref: 'o1', order_total_ngn: 1000, timestamp: '2026-01-01T00:00:00.000Z' }));
  // a record that stored a rate but no amount -> uses ITS rate
  await k.put('referral:OLD01:o2', JSON.stringify({ ref_code: 'OLD01', tx_ref: 'o2', order_total_ngn: 1000, commission_rate: 0.05, timestamp: '2026-01-02T00:00:00.000Z' }));
  // metadata with total but no amount and no rate
  await k.put('referral:OLD01:o3', JSON.stringify({ ref_code: 'OLD01', tx_ref: 'o3', order_total_ngn: 1000, commission_ngn: 80 }), { metadata: { c: 'OLD01', t: 1000, ts: '2026-01-03T00:00:00.000Z' } });
  // fully modern
  await k.put('referral:OLD01:o4', JSON.stringify({ ref_code: 'OLD01', tx_ref: 'o4', order_total_ngn: 1000, commission_ngn: 120, commission_rate: 0.12 }), { metadata: { c: 'OLD01', t: 1000, m: 120, r: 0.12, ts: '2026-01-04T00:00:00.000Z' } });
  const st = await (await myStats({ request: new Request('https://x/api/get-my-stats?code=OLD01'), env: e })).json();
  check('80 (the original 8%, NOT today\'s 15%) + 50 (its own 5%) + 80 + 120 = 330', st.commission_ngn === 330 && st.orders === 4 && st.total_sales_ngn === 4000, JSON.stringify(st));
  const rp = (await (await getReferrals({ request: body({ password: PW }), env: e })).json()).rows.find((x) => x.code === 'OLD01');
  check('the report agrees', rp.commission_earned_ngn === 330, JSON.stringify(rp));
  const det = await (await getReferrals({ request: body({ password: PW, code: 'OLD01' }), env: e })).json();
  check('the detail shows each order\'s own rate (a record with no rate shows the legacy 8%)', det.orders_detail.map((o) => o.commission_rate).sort().join() === [0.05, 0.08, 0.08, 0.12].join(), det.orders_detail.map((o) => o.commission_rate).join());
}

console.log('\n=== the admin report flags price mismatches ===');
{
  const rp = await report();
  const row = rp.rows.find((x) => x.code === 'ADA01');
  check('the affiliate\'s row counts the mismatched orders (a3, m1, m2 = 3)', row.price_mismatch_orders === 3, row.price_mismatch_orders);
  const det = await report({ code: 'ADA01' });
  check('the order detail marks which ones, with version and rate', det.orders_detail.filter((o) => o.price_mismatch).map((o) => o.tx_ref).sort().join() === 'a3,m1,m2' && det.orders_detail.find((o) => o.tx_ref === 'a1').pricing_version === 1 && det.orders_detail.find((o) => o.tx_ref === 'l1').legacy === true, JSON.stringify(det.orders_detail.slice(0, 2)));
  check('the legacy count shows too', det.orders_detail.filter((o) => o.legacy).length >= 10);
}

console.log('\n=== the commission rate people are TOLD comes from the current config ===');
{
  const k = makeKV(); const e = { ...env, REFERRALS_KV: k };
  await k.put('affiliate:WEL01', JSON.stringify({ name: 'Wel Come', email: 'wel@example.com', approved_at: 'x' }));
  mails = [];
  let rr = await sendEmail({ request: body({ password: PW, code: 'WEL01' }), env: e });
  check('with the default 8%: "8% commission" in the welcome email (html and text)', (await rr.json()).ok && /<strong>8% commission<\/strong>/.test(mails[0].html) && /earn 8% commission/.test(mails[0].text) && /earn 8% commission on every completed sale/.test(mails[0].html), mails[0].html.slice(0, 0));
  await adminPricing({ request: body({ password: PW, action: 'save', commission_rate: 0.1 }), env: e });
  mails = [];
  rr = await sendEmail({ request: body({ password: PW, code: 'WEL01' }), env: e });
  check('after the rate becomes 10%: the email says 10% everywhere and never 8%', /<strong>10% commission<\/strong>/.test(mails[0].html) && /earn 10% commission/.test(mails[0].text) && !/8%/.test(mails[0].html + mails[0].text), mails[0].text.slice(0, 0));
  await adminPricing({ request: body({ password: PW, action: 'save', commission_rate: 0.075 }), env: e });
  mails = []; await sendEmail({ request: body({ password: PW, code: 'WEL01' }), env: e });
  check('a fractional rate reads naturally (7.5%)', /<strong>7\.5% commission<\/strong>/.test(mails[0].html));
  check('the pure builder defaults to 8% when no rate is given, and takes one when it is', /8% commission/.test(buildWelcomeEmail({ name: 'A', code: 'ABC' }).html) && /12% commission/.test(buildWelcomeEmail({ name: 'A', code: 'ABC', commissionRate: 0.12 }).html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
