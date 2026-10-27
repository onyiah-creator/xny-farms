/**
 * Tests for commission recorded against the price in force: versioned commission,
 * browser-total mismatch flagging, the legacy fallback, and the guarantee that later
 * price or rate changes never alter what was already recorded, reported or shown to affiliates.
 *
 *   node tests/log-referral-pricing.test.mjs
 */
import { placeOrder, payOrder, paidSale } from './helpers/paid-order.mjs';
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
const env = { REFERRALS_KV: KV, ADMIN_REPORT_PASSWORD: PW, RESEND_API_KEY: 're_test', FLW_SECRET_KEY: 'FLWSECK-test' };
let mails = [];
globalThis.fetch = async (url, init) => { mails.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 're_' + mails.length }), { status: 200 }); };
const body = (b) => new Request('https://x/api', { method: 'POST', body: JSON.stringify(b) });
const place = (b) => placeOrder(env, { items: ITEMS, ...b });
const pay = (order, o) => payOrder(env, order, o);
const sale = async (b) => { const r = await paidSale(env, { items: ITEMS, ...b }); return { ...r, credited: KV._s.has(`referral:${(b.ref_code || '').toUpperCase()}:${r.tx_ref}`) }; };
const adm = async (b) => { const r = await adminPricing({ request: body({ password: PW, ...b }), env }); return { status: r.status, j: await r.json() }; };
const report = async (extra = {}) => (await getReferrals({ request: body({ password: PW, ...extra }), env })).json();
const stats = async (code = 'ADA01') => (await myStats({ request: new Request('https://x/api/get-my-stats?code=' + code), env })).json();
const rec = (tx) => JSON.parse(KV._s.get(`referral:ADA01:${tx}`).value);
const meta = (tx) => KV._s.get(`referral:ADA01:${tx}`).metadata;

const ITEMS = [{ id: 'ashe-honey-50cl', qty: 2 }, { id: 'palm-oil-50cl', qty: 1 }];   // 2 x 7,000 + 700 = 14,700 at v1
await KV.put('affiliate:ADA01', JSON.stringify({ name: 'Ada Eze', email: 'ada@example.com', approved_at: '2026-01-01T00:00:00.000Z', status: 'active' }), { metadata: { n: 'Ada Eze', e: 'ada@example.com', at: '2026-01-01T00:00:00.000Z', s: 'active' } });

console.log('=== a verified order is priced by the SERVER, and commission is fixed at that price and rate ===');
let o = await sale({ ref_code: 'ada01' });
let a1 = rec(o.tx_ref);
check('credited; commission = 8% x 14,700 = 1,176 (subtotal, delivery excluded)', o.state === 'paid' && a1.commission_ngn === 1176 && a1.order_total_ngn === 14700 && a1.pricing_version === 1 && a1.commission_rate === 0.08 && a1.verified === true, JSON.stringify(a1));
check('the record stores pricing_version, items (with the prices used), commission_rate, commission_ngn and order_total_ngn',
  JSON.stringify(a1.items) === JSON.stringify([{ id: 'ashe-honey-50cl', qty: 2, price_ngn: 7000 }, { id: 'palm-oil-50cl', qty: 1, price_ngn: 700 }]), JSON.stringify(a1));
check('not flagged: no price_mismatch, no legacy', !('price_mismatch' in a1) && !('legacy' in a1));
check('metadata carries the short figures plus rate and version', JSON.stringify(Object.keys(meta(o.tx_ref)).sort()) === JSON.stringify(['c', 'm', 'r', 't', 'ts', 'v']) && meta(o.tx_ref).r === 0.08 && meta(o.tx_ref).v === 1 && meta(o.tx_ref).m === 1176);
o = await sale({ ref_code: 'ada01', fulfilment: 'lagos' });
check('delivery is paid for but earns nothing: Lagos order, still 8% of 14,700', rec(o.tx_ref).commission_ngn === 1176 && rec(o.tx_ref).gross_total_ngn === 16200);

console.log('\n=== prices and the rate change: orders keep the price and rate in force when they were PLACED ===');
const early = await place({ ref_code: 'ada01' });                                    // placed under v1 (8%)
await adm({ action: 'save', products: { 'ashe-honey-50cl': { price_ngn: 8000 } }, commission_rate: 0.1, note: 'Honey up, commission up' });   // v2 live
advance(60e3);
await pay(early);
check('placed under v1, paid after the change: still 14,700 x 8% = 1,176, version 1', rec(early.tx_ref).order_total_ngn === 14700 && rec(early.tx_ref).commission_ngn === 1176 && rec(early.tx_ref).commission_rate === 0.08 && rec(early.tx_ref).pricing_version === 1, JSON.stringify(rec(early.tx_ref)));
o = await sale({ ref_code: 'ada01' });
check('placed under v2: 2 x 8,000 + 700 = 16,700, commission 10% = 1,670, stored with rate 0.1 and version 2', rec(o.tx_ref).order_total_ngn === 16700 && rec(o.tx_ref).commission_ngn === 1670 && rec(o.tx_ref).commission_rate === 0.1 && rec(o.tx_ref).pricing_version === 2);
advance(30 * HOUR);
await pay(early);                                                                     // idempotent
check('replaying the confirmation 30 hours later changes nothing', rec(early.tx_ref).commission_ngn === 1176 && rec(early.tx_ref).commission_rate === 0.08);

console.log('\n=== only verified sales earn ===');
{
  const k = makeKV(); const e = { ...env, REFERRALS_KV: k };
  await k.put('affiliate:PAUSED1', JSON.stringify({ status: 'suspended' }));
  const ps = await paidSale(e, { items: ITEMS, ref_code: 'paused1' });
  check('suspended affiliates still earn nothing', ps.state === 'paid' && ![...k._s.keys()].some((x) => x.startsWith('referral:')));
}
{
  const un = await place({ ref_code: 'ada01' });
  check('an order that was never paid earns nothing', !KV._s.has(`referral:ADA01:${un.tx_ref}`));
  const under = await place({ ref_code: 'ada01' });
  await pay(under, { amount: 1 });
  check('an under-paid order earns nothing', !KV._s.has(`referral:ADA01:${under.tx_ref}`));
}
check('an unknown code earns nothing', !(await sale({ ref_code: 'nobody' })).credited);

console.log('\n=== history is immutable: changing prices and the rate never touches what was recorded ===');
{
  const k = makeKV(); const e = { ...env, REFERRALS_KV: k };
  const e2 = { ...e, FLW_SECRET_KEY: 'FLWSECK-test' };
  const L = (b) => paidSale(e2, { ref_code: 'zed01', ...b });
  const A = async (b) => (await adminPricing({ request: body({ password: PW, ...b }), env: e })).json();
  const REP = async (x = {}) => (await getReferrals({ request: body({ password: PW, ...x }), env: e })).json();
  const ST = async () => (await myStats({ request: new Request('https://x/api/get-my-stats?code=ZED01'), env: e })).json();
  await k.put('affiliate:ZED01', JSON.stringify({ name: 'Zed Zee', email: 'zed@example.com', approved_at: '2026-01-01T00:00:00.000Z' }), { metadata: { n: 'Zed Zee', e: 'zed@example.com', at: '2026-01-01T00:00:00.000Z' } });
  const h1 = (await L({ items: ITEMS })).tx_ref;                     // 14,700 @ 8% = 1,176
  const before = { rec: k._s.get(`referral:ZED01:${h1}`).value, meta: JSON.stringify(k._s.get(`referral:ZED01:${h1}`).metadata), rep: await REP(), det: await REP({ code: 'ZED01' }), st: await ST() };
  check('(baseline) earned 1,176 on 14,700', before.st.commission_ngn === 1176 && before.st.total_sales_ngn === 14700 && before.rep.rows.find((x) => x.code === 'ZED01').commission_earned_ngn === 1176);
  advance(60e3);
  await A({ action: 'save', products: { 'ashe-honey-50cl': { price_ngn: 9999 }, 'palm-oil-50cl': { price_ngn: 999 } }, commission_rate: 0.2, note: 'Big change' });
  advance(60e3);
  await A({ action: 'save', commission_rate: 0.05, processor_fee_rate: 0.04, delivery: { lagos: { customer_charge_ngn: 9000 } }, note: 'And another' });
  const after = { rec: k._s.get(`referral:ZED01:${h1}`).value, meta: JSON.stringify(k._s.get(`referral:ZED01:${h1}`).metadata), rep: await REP(), det: await REP({ code: 'ZED01' }), st: await ST() };
  check('the earlier ORDER RECORD and its metadata are byte-for-byte unchanged', after.rec === before.rec && after.meta === before.meta);
  check('the REPORT row for that affiliate (orders, sales, earned, balance) is unchanged', JSON.stringify(after.rep.rows.find((x) => x.code === 'ZED01')) === JSON.stringify(before.rep.rows.find((x) => x.code === 'ZED01')) && JSON.stringify(after.rep.totals) === JSON.stringify(before.rep.totals));
  check('the order detail still shows its own rate (8%) and version (1)', after.det.orders_detail[0].commission_rate === 0.08 && after.det.orders_detail[0].pricing_version === 1 && after.det.orders_detail[0].commission_ngn === 1176 && after.det.orders_detail[0].order_total_ngn === 14700);
  check('the AFFILIATE\'S stats are unchanged (earned and sales), though the displayed rate is the new current one', after.st.commission_ngn === before.st.commission_ngn && after.st.total_sales_ngn === before.st.total_sales_ngn && after.st.orders === 1 && after.st.balance_due_ngn === before.st.balance_due_ngn);
  check('display-only: both endpoints now show the CURRENT rate (5%)', after.st.commission_rate === 0.05 && after.rep.commission_rate === 0.05 && before.st.commission_rate === 0.08, [after.st.commission_rate, after.rep.commission_rate].join());
  const h2 = (await L({ items: [{ id: 'palm-oil-50cl', qty: 1 }] })).tx_ref;
  const h2r = JSON.parse(k._s.get(`referral:ZED01:${h2}`).value);
  check('a NEW order is recorded at the new price and rate: 999 x 5% = 49.95', h2r.order_total_ngn === 999 && h2r.commission_ngn === 49.95 && h2r.commission_rate === 0.05);
  const st2 = await ST();
  check('totals are the OLD order at its rate plus the NEW order at its rate: 1,176 + 49.95', st2.commission_ngn === 1225.95 && st2.total_sales_ngn === 15699 && st2.orders === 2, JSON.stringify(st2));
  const rp2 = (await REP()).rows.find((x) => x.code === 'ZED01');
  check('and the report agrees (earned 1,225.95)', rp2.commission_earned_ngn === 1225.95 && rp2.total_sales_ngn === 15699);
  await A({ action: 'revert_to', version: 1 });
  check('even reverting the pricing back to v1 changes no earlier record', k._s.get(`referral:ZED01:${h1}`).value === before.rec && (await ST()).commission_ngn === 1225.95);
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

console.log('\n=== the admin report still flags old records whose price was corrected or estimated ===');
{
  const k = makeKV(); const e = { ...env, REFERRALS_KV: k };
  await k.put('affiliate:MIS01', JSON.stringify({ name: 'Mis Match', email: 'mis@example.com', approved_at: 'x' }), { metadata: { n: 'Mis Match', e: 'mis@example.com', at: 'x' } });
  const put = (tx, extra, m = {}) => k.put(`referral:MIS01:${tx}`, JSON.stringify({ ref_code: 'MIS01', tx_ref: tx, order_total_ngn: 1000, commission_ngn: 80, commission_rate: 0.08, timestamp: '2026-03-01T00:00:00.000Z', ...extra }), { metadata: { c: 'MIS01', t: 1000, m: 80, ts: '2026-03-01T00:00:00.000Z', ...m } });
  await put('p1', { price_mismatch: true, browser_order_total_ngn: 5 }, { pm: 1 });
  await put('p2', { legacy: true }, { lg: 1 });
  await put('p3', { pricing_version: 1 }, { v: 1 });
  const rp = (await (await getReferrals({ request: body({ password: PW }), env: e })).json()).rows.find((x) => x.code === 'MIS01');
  check('the affiliate\'s row counts the flagged orders', rp.price_mismatch_orders === 1, JSON.stringify(rp));
  const det = await (await getReferrals({ request: body({ password: PW, code: 'MIS01' }), env: e })).json();
  check('the order detail marks which ones', det.orders_detail.filter((x) => x.price_mismatch).map((x) => x.tx_ref).join() === 'p1' && det.orders_detail.find((x) => x.tx_ref === 'p2').legacy === true && det.orders_detail.find((x) => x.tx_ref === 'p3').pricing_version === 1);
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
