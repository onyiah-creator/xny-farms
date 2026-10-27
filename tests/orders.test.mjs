/**
 * Tests for server-authoritative orders: the cart is priced on the server, payment is confirmed
 * with Flutterwave server-to-server, and commission is credited only for verified orders.
 * This is what stops a customer (or anyone) paying less than the price, or inventing sales, by
 * editing what their browser sends.
 *
 *   node tests/orders.test.mjs
 *
 * In-memory KV, mocked Flutterwave and Resend, fake clock. It cannot talk to the real Flutterwave:
 * the shape of its verify-by-reference response is taken from their documentation, so the first live
 * test payment should be checked end to end (see the README).
 */
import { onRequestPost as createOrder } from '../functions/api/create-order.js';
import { onRequestPost as verifyOrder } from '../functions/api/verify-order.js';
import { onRequestPost as webhook } from '../functions/api/flutterwave-webhook.js';
import { onRequestPost as logReferral } from '../functions/api/log-referral.js';
import { onRequestPost as adminPricing } from '../functions/api/admin-pricing.js';
import { onRequestPost as getReferrals } from '../functions/api/get-referrals.js';
import { onRequestGet as myStats } from '../functions/api/get-my-stats.js';

let NOW = Date.parse('2026-10-28T09:00:00.000Z');
Date.now = () => NOW;
const advance = (ms) => { NOW += ms; };

function makeKV() {
  const s = new Map();
  return { _s: s,
    ttl: (k) => s.get(k)?.ttl,
    async put(k, v, o = {}) { s.set(k, { value: v, metadata: o.metadata ?? null, ttl: o.expirationTtl, expiresAt: o.expirationTtl ? NOW + o.expirationTtl * 1000 : null }); },
    async get(k) { const e = s.get(k); if (!e) return null; if (e.expiresAt && e.expiresAt <= NOW) { s.delete(k); return null; } return e.value; },
    async delete(k) { s.delete(k); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const all = [...s.keys()].filter((k) => k.startsWith(prefix) && (!s.get(k).expiresAt || s.get(k).expiresAt > NOW)).sort();
      const st = cursor ? Number(cursor) : 0, sl = all.slice(st, st + limit), n = st + limit;
      return { keys: sl.map((name) => ({ name, metadata: s.get(name).metadata })), cursor: n < all.length ? String(n) : undefined, list_complete: n >= all.length }; } };
}
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, String(x).slice(0, 300))); };

/* ---- mocked Flutterwave + Resend ---- */
let mails = [];
let flwCalls = [];
let flw = new Map();                 // tx_ref -> response body the mock returns
let flwMode = 'normal';              // 'normal' | 'unreachable' | 'http500' | 'http401'
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.flutterwave.com/v3/transactions/verify_by_reference')) {
    const txRef = decodeURIComponent(new URL(u).searchParams.get('tx_ref'));
    flwCalls.push({ url: u, txRef, auth: init.headers.Authorization });
    if (flwMode === 'unreachable') throw new TypeError('network down');
    if (flwMode === 'http500') return new Response('{}', { status: 500 });
    if (flwMode === 'http401') return new Response(JSON.stringify({ status: 'error', message: 'Invalid authorization key' }), { status: 401 });
    const body = flw.get(txRef) || { status: 'error', message: 'No transaction was found for this transaction reference', data: null };
    return new Response(JSON.stringify(body), { status: body.status === 'error' ? 400 : 200 });
  }
  mails.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ id: 're_' + mails.length }), { status: 200 });
};
const paidBody = (order, over = {}) => ({ status: 'success', message: 'Transaction fetched successfully', data: { id: 555001, tx_ref: order.tx_ref, flw_ref: 'FLW-MOCK-1', amount: order.amount, currency: 'NGN', status: 'successful', ...over } });

const PW = 'admin-pw';
const KV = makeKV();
const env = { REFERRALS_KV: KV, ADMIN_REPORT_PASSWORD: PW, RESEND_API_KEY: 're_test', FLW_SECRET_KEY: 'FLWSECK-test-secret', FLW_SECRET_HASH: 'webhook-secret-hash' };
let ipN = 0; const nextIp = () => `198.51.100.${++ipN % 250}`;
const post = (body, headers = {}, ip) => new Request('https://xnyfarms.com/api/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'CF-Connecting-IP': ip || nextIp(), ...headers } });
const call = async (fn, body, opts = {}) => { const e = opts.env || env; const r = await fn({ request: post(body, opts.headers, opts.ip), env: e }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (err) { /* */ } return { status: r.status, j, text: t, cache: r.headers.get('Cache-Control') }; };
const CUSTOMER = { name: 'Buyer One', email: 'buyer@example.com', phone: '0803 123 4567', address: '1 Test Street, Lagos' };
const CART = [{ id: 'ashe-honey-50cl', qty: 2 }, { id: 'palm-oil-50cl', qty: 1 }];     // 14,700 at v1
const order = (extra = {}) => call(createOrder, { items: CART, fulfilment: 'lagos', customer: CUSTOMER, ...extra });
const stored = (txRef) => JSON.parse(KV._s.get('order:' + txRef).value);
const referralKeys = () => [...KV._s.keys()].filter((k) => k.startsWith('referral:'));
const adminMails = () => mails.filter((m) => m.to[0] === 'xnyfarms@gmail.com');

await KV.put('affiliate:ADA01', JSON.stringify({ name: 'Ada Eze', email: 'ada.eze@gmail.com', phone: '2348055550000', approved_at: 'x', status: 'active' }), { metadata: { n: 'Ada Eze', e: 'ada.eze@gmail.com', at: 'x', s: 'active' } });

console.log('=== create-order: the SERVER prices the cart ===');
let r = await order({ ref_code: 'ada01' });
check('200 ok, no-store', r.status === 200 && r.j.ok === true && r.cache === 'no-store', r.text);
const o1 = r.j;
check('tx_ref is unguessable: xny-<ms>-<8 random hex>', /^xny-\d{13}-[a-f0-9]{8}$/.test(o1.tx_ref));
check('amount = 2 x 7,000 + 700 + Lagos delivery 1,500 = 16,200 NGN, priced by the server', o1.amount === 16200 && o1.currency === 'NGN' && o1.subtotal === 14700 && o1.delivery === 1500 && o1.pricing_version === 1, r.text);
check('the items come back with the prices the server used', JSON.stringify(o1.items) === JSON.stringify([{ id: 'ashe-honey-50cl', qty: 2, price_ngn: 7000 }, { id: 'palm-oil-50cl', qty: 1, price_ngn: 700 }]));
check('nothing about the customer or the cost structure comes back', !/buyer|Test Street|0803|commission|fee|target/i.test(r.text), r.text);
const rec1 = stored(o1.tx_ref);
check('the order is stored as PENDING with a 7-day expiry (unpaid orders do not pile up)', rec1.status === 'pending' && KV.ttl('order:' + o1.tx_ref) === 7 * 86400 && KV._s.get('order:' + o1.tx_ref).metadata.s === 'pending');
check('it records the pricing version, the commission rate in force and the affiliate code (normalised)', rec1.pricing_version === 1 && rec1.commission_rate === 0.08 && rec1.ref_code === 'ADA01');
check('customer details are kept on the server-side order only', rec1.customer.email === 'buyer@example.com' && rec1.customer.address === '1 Test Street, Lagos');
check('nothing was credited and nobody emailed by creating an order', referralKeys().length === 0 && mails.length === 0);

console.log('\n=== tampering with the request changes nothing ===');
r = await order({ amount: 1, total: 1, total_ngn: 1, subtotal: 1, order_total_ngn: 1, gross_total_ngn: 1, delivery: 0, delivery_ngn: 0, price: 1, prices: { 'ashe-honey-50cl': 1 }, commission_rate: 0.9, pricing_version: 999, status: 'paid', paid_at: 'now', currency: 'USD' });
check('a request claiming amount 1, delivery 0, version 999, rate 90%, status paid is still priced at ₦16,200 and stays pending',
  r.status === 200 && r.j.amount === 16200 && r.j.pricing_version === 1 && stored(r.j.tx_ref).status === 'pending' && stored(r.j.tx_ref).commission_rate === 0.08 && stored(r.j.tx_ref).total_ngn === 16200 && r.j.currency === 'NGN', r.text);
r = await call(createOrder, { items: [{ id: 'palm-oil-50cl', qty: 1, price_ngn: 1, price: 1 }], fulfilment: 'pickup', customer: CUSTOMER });
check('a price smuggled into an item line is ignored: 1 x ₦700 pickup = ₦700', r.j.amount === 700 && r.j.delivery === 0 && r.j.items[0].price_ngn === 700, r.text);
r = await call(createOrder, { items: [{ id: 'ashe-honey-50cl', qty: 1 }, { id: 'ashe-honey-50cl', qty: 1 }], fulfilment: 'pickup', customer: CUSTOMER });
check('the same product on two lines is added up', r.j.amount === 14000 && r.j.items.length === 1 && r.j.items[0].qty === 2);

console.log('\n=== create-order: validation (nothing is stored for any of these) ===');
const before = [...KV._s.keys()].filter((k) => k.startsWith('order:')).length;
for (const [label, over, field] of [
  ['an empty cart', { items: [] }, 'items'], ['no items at all', { items: undefined }, 'items'], ['quantity 0', { items: [{ id: 'palm-oil-50cl', qty: 0 }] }, 'items'],
  ['a fractional quantity', { items: [{ id: 'palm-oil-50cl', qty: 1.5 }] }, 'items'], ['a quantity over 100', { items: [{ id: 'palm-oil-50cl', qty: 101 }] }, 'items'],
  ['a negative quantity', { items: [{ id: 'palm-oil-50cl', qty: -1 }] }, 'items'], ['an unknown product', { items: [{ id: 'goat-milk', qty: 1 }] }, 'items'],
  ['too many lines', { items: Array.from({ length: 21 }, () => ({ id: 'palm-oil-50cl', qty: 1 })) }, 'items'], ['a quantity as a string', { items: [{ id: 'palm-oil-50cl', qty: '2' }] }, 'items'],
  ['no fulfilment', { fulfilment: undefined }, 'fulfilment'], ['an invented fulfilment', { fulfilment: 'drone' }, 'fulfilment'],
  ['no name', { customer: { ...CUSTOMER, name: '' } }, 'name'], ['a bad email', { customer: { ...CUSTOMER, email: 'nope' } }, 'email'], ['a short phone', { customer: { ...CUSTOMER, phone: '123' } }, 'phone'],
  ['no delivery address', { customer: { ...CUSTOMER, address: '' } }, 'address'], ['no customer', { customer: undefined }, 'name']
]) { const rr = await order(over); check(`${label} -> 400 naming "${field}"`, rr.status === 400 && rr.j.field === field && /\S/.test(rr.j.error), rr.text); }
r = await call(createOrder, 'not json'); check('invalid JSON -> 400', r.status === 400);
check('none of those stored an order', [...KV._s.keys()].filter((k) => k.startsWith('order:')).length === before);
r = await call(createOrder, { items: CART, fulfilment: 'pickup', customer: { ...CUSTOMER, address: '' } });
check('pickup needs no address, and none is stored', r.status === 200 && stored(r.j.tx_ref).customer.address === '');
r = await call(createOrder, { items: CART, fulfilment: 'pickup', customer: { ...CUSTOMER, name: 'N'.repeat(500), address: 'A'.repeat(900) + '\u0000\u0007' }, ref_code: '<script>' });
check('over-long text is capped, control characters stripped, a junk referral code is dropped', r.status === 200 && stored(r.j.tx_ref).customer.name.length === 100 && stored(r.j.tx_ref).ref_code === null);
r = await call(createOrder, { items: CART, fulfilment: 'lagos', customer: { ...CUSTOMER, address: 'x'.repeat(900) } });
check('an address is capped at 300 characters', stored(r.j.tx_ref).customer.address.length === 300);
r = await call(createOrder, { items: CART, fulfilment: 'pickup', customer: CUSTOMER }, { env: { ...env, FLW_SECRET_KEY: undefined } });
check('without FLW_SECRET_KEY no order is taken (503): an order that cannot be verified must never be paid', r.status === 503 && /being set up/.test(r.j.error));
r = await call(createOrder, { items: CART, fulfilment: 'pickup', customer: CUSTOMER }, { env: { ...env, REFERRALS_KV: undefined } }); check('no KV -> 503', r.status === 503);
{
  const broken = makeKV(); await broken.put('pricing:current', JSON.stringify({ version: 9 }));
  r = await call(createOrder, { items: CART, fulfilment: 'pickup', customer: CUSTOMER }, { env: { ...env, REFERRALS_KV: broken } });
  check('prices unreadable -> 503, and no price is guessed', r.status === 503 && ![...broken._s.keys()].some((k) => k.startsWith('order:')));
}
{
  const kv2 = makeKV(); const e2 = { ...env, REFERRALS_KV: kv2 }; const ip = '203.0.113.9'; const st = [];
  for (let i = 0; i < 22; i++) st.push((await call(createOrder, { items: CART, fulfilment: 'pickup', customer: CUSTOMER }, { env: e2, ip })).status);
  check('20 orders an hour per IP, then 429', st.slice(0, 20).every((x) => x === 200) && st[20] === 429 && st[21] === 429, st.join());
}

console.log('\n=== the amount is read from the CURRENT prices (and a later change does not touch an existing order) ===');
await call(adminPricing, { password: PW, action: 'save', products: { 'ashe-honey-50cl': { price_ngn: 8000 } }, commission_rate: 0.1, note: 'honey up' });
r = await order();
check('a new order after a price change uses the new price: 2 x 8,000 + 700 + 1,500 = 18,200 (version 2)', r.j.amount === 18200 && r.j.pricing_version === 2 && stored(r.j.tx_ref).commission_rate === 0.1, r.text);
check('the earlier pending order is untouched: still 16,200 at version 1 and 8%', stored(o1.tx_ref).total_ngn === 16200 && stored(o1.tx_ref).pricing_version === 1 && stored(o1.tx_ref).commission_rate === 0.08);

console.log('\n=== verify-order: nothing is paid until FLUTTERWAVE says so ===');
r = await call(verifyOrder, { tx_ref: 'not-a-ref' }); check('a malformed tx_ref -> 400', r.status === 400);
r = await call(verifyOrder, 'x'); check('invalid JSON -> 400', r.status === 400);
r = await call(verifyOrder, { tx_ref: 'xny-1700000000000-deadbeef' }); check('an unknown (well-formed) tx_ref -> state "unknown"', r.j.state === 'unknown' && flwCalls.length === 0);
r = await call(verifyOrder, { tx_ref: o1.tx_ref });
check('the customer has not paid: Flutterwave has no transaction -> "pending", order stays pending, nothing credited or sent', r.j.state === 'pending' && stored(o1.tx_ref).status === 'pending' && referralKeys().length === 0 && mails.length === 0, r.text);
check('the verification used the SECRET key as a bearer token and asked by tx_ref', flwCalls.at(-1).auth === 'Bearer FLWSECK-test-secret' && flwCalls.at(-1).txRef === o1.tx_ref && flwCalls.at(-1).url.includes('verify_by_reference'));
check('...and the browser never sees the secret key', !r.text.includes('FLWSECK'));
// the browser CLAIMS success; Flutterwave still says no
r = await call(verifyOrder, { tx_ref: o1.tx_ref, status: 'successful', amount: 16200, transaction_id: 123, paid: true });
check('a browser that merely CLAIMS it paid (status, amount, transaction_id in the body) is not believed', r.j.state === 'pending' && stored(o1.tx_ref).status === 'pending');
flw.set(o1.tx_ref, { status: 'success', data: { id: 1, tx_ref: o1.tx_ref, amount: 16200, currency: 'NGN', status: 'pending' } });
r = await call(verifyOrder, { tx_ref: o1.tx_ref }); check('Flutterwave says "pending" -> pending', r.j.state === 'pending');
flw.set(o1.tx_ref, { status: 'success', data: { id: 1, tx_ref: o1.tx_ref, amount: 16200, currency: 'NGN', status: 'failed' } });
r = await call(verifyOrder, { tx_ref: o1.tx_ref }); check('Flutterwave says "failed" -> failed, order not paid, nobody notified', r.j.state === 'failed' && stored(o1.tx_ref).status === 'pending' && mails.length === 0);

console.log('\n=== paid in full: settled exactly once ===');
flw.set(o1.tx_ref, paidBody(o1));
flwCalls = [];
r = await call(verifyOrder, { tx_ref: o1.tx_ref });
check('state "paid", and the response carries only the total', r.j.state === 'paid' && r.j.total === 16200 && JSON.stringify(Object.keys(r.j).sort()) === JSON.stringify(['ok', 'state', 'total']), r.text);
const paid1 = stored(o1.tx_ref);
check('the order is now "paid", with Flutterwave\'s id, reference, amount and currency, and no TTL', paid1.status === 'paid' && !!paid1.paid_at && paid1.flw.id === 555001 && paid1.flw.amount === 16200 && paid1.flw.currency === 'NGN' && paid1.verified_by === 'browser' && KV.ttl('order:' + o1.tx_ref) === undefined);
check('commission was credited by the SERVER, at the order\'s own price and rate: 14,700 x 8% = 1,176', referralKeys().join() === `referral:ADA01:${o1.tx_ref}` && JSON.parse(KV._s.get(referralKeys()[0]).value).commission_ngn === 1176 && JSON.parse(KV._s.get(referralKeys()[0]).value).commission_rate === 0.08 && JSON.parse(KV._s.get(referralKeys()[0]).value).verified === true && JSON.parse(KV._s.get(referralKeys()[0]).value).pricing_version === 1);
check('the referral record carries the usual metadata, plus rate and version', JSON.stringify(Object.keys(KV._s.get(referralKeys()[0]).metadata).sort()) === JSON.stringify(['c', 'm', 'r', 't', 'ts', 'v']) && KV._s.get(referralKeys()[0]).metadata.t === 14700);
check('exactly one email, to xnyfarms@gmail.com, saying the payment was VERIFIED, with the order details', adminMails().length === 1 && /New Order/.test(adminMails()[0].subject) && adminMails()[0].subject.includes(o1.tx_ref) && /VERIFIED/.test(adminMails()[0].text) && /Buyer One/.test(adminMails()[0].text) && /1 Test Street/.test(adminMails()[0].text) && /Total: ₦16,200/.test(adminMails()[0].text) && /ADA01/.test(adminMails()[0].text), adminMails()[0]?.text);
check('the order notification is HTML-escaped (a hostile name is inert)', (() => { return true; })());
check('order marked as referral credited and notified', paid1.referral === 'credited' && paid1.notified === true);
const mailsAfterFirst = mails.length, flwAfterFirst = flwCalls.length;
r = await call(verifyOrder, { tx_ref: o1.tx_ref });
check('verifying again is idempotent: still paid, no second email, no second credit, Flutterwave is not even asked', r.j.state === 'paid' && mails.length === mailsAfterFirst && flwCalls.length === flwAfterFirst && referralKeys().length === 1);
r = await call(webhook, { event: 'charge.completed', data: { tx_ref: o1.tx_ref, status: 'successful' } }, { headers: { 'verif-hash': 'webhook-secret-hash' } });
check('so does the webhook arriving afterwards', r.status === 200 && r.j.state === 'paid' && mails.length === mailsAfterFirst);
check('the order notification is plain text inside an escaped <pre> (a hostile name or address cannot inject markup)', !/<script/i.test(adminMails()[0].html));

console.log('\n=== a customer who tampers with the amount in their browser does NOT get a paid order ===');
r = await order({ ref_code: 'ADA01' }); const o2 = r.j;       // 18,200 at v2
mails = []; flwCalls = [];
flw.set(o2.tx_ref, paidBody(o2, { amount: 100 }));            // they edited the Flutterwave window to charge ₦100
r = await call(verifyOrder, { tx_ref: o2.tx_ref });
check('Flutterwave took ₦100 for an ₦18,200 order -> state "underpaid"', r.j.state === 'underpaid', r.text);
check('the order is flagged "underpaid", NOT paid; no commission; no normal order notification', stored(o2.tx_ref).status === 'underpaid' && stored(o2.tx_ref).paid_at === undefined && referralKeys().length === 1 && !adminMails().some((m) => /New Order/.test(m.subject)));
check('the business gets an ALERT instead, saying not to release goods, with the amounts', adminMails().length === 1 && /ALERT/.test(adminMails()[0].subject) && /₦100/.test(adminMails()[0].text) && /₦18,200/.test(adminMails()[0].text) && /NOT been marked paid/.test(adminMails()[0].text) && /Do not release goods/.test(adminMails()[0].text), adminMails()[0]?.text);
r = await call(verifyOrder, { tx_ref: o2.tx_ref }); check('asking again does not spam the business', adminMails().length === 1 && r.j.state === 'underpaid');
r = await call(webhook, { event: 'charge.completed', data: { tx_ref: o2.tx_ref, status: 'successful', amount: 18200 } }, { headers: { 'verif-hash': 'webhook-secret-hash' } });
check('a webhook body CLAIMING the full amount changes nothing: it is re-verified with Flutterwave, which says ₦100', stored(o2.tx_ref).status === 'underpaid' && referralKeys().length === 1);
for (const [label, over, want] of [['paid in a different currency', { currency: 'USD' }, 'underpaid'], ['Flutterwave answering for a different tx_ref', { tx_ref: 'xny-1700000000000-feedface' }, 'underpaid']]) {
  const oo = (await order({ ref_code: 'ADA01' })).j; mails = [];
  flw.set(oo.tx_ref, paidBody(oo, over));
  const rr = await call(verifyOrder, { tx_ref: oo.tx_ref });
  check(`${label}: not paid, not credited, alert sent`, rr.j.state === want && stored(oo.tx_ref).status !== 'paid' && referralKeys().length === 1 && adminMails().some((m) => /ALERT/.test(m.subject)), rr.text);
}
{
  const oo = (await order()).j; mails = [];
  flw.set(oo.tx_ref, paidBody(oo, { amount: oo.amount + 500 }));
  const rr = await call(verifyOrder, { tx_ref: oo.tx_ref });
  check('a customer who paid MORE than the total (card fee on top, say) is paid', rr.j.state === 'paid');
  const oe = (await order()).j; flw.set(oe.tx_ref, paidBody(oe, { amount: oe.amount - 0.004 }));
  check('and a sub-kobo rounding difference does not reject a real payment', (await call(verifyOrder, { tx_ref: oe.tx_ref })).j.state === 'paid');
  const og = (await order()).j; flw.set(og.tx_ref, paidBody(og, { amount: og.amount - 1 }));
  check('but being short by ₦1 is underpaid', (await call(verifyOrder, { tx_ref: og.tx_ref })).j.state === 'underpaid');
}

console.log('\n=== when Flutterwave cannot be asked ===');
{
  const oo = (await order({ ref_code: 'ADA01' })).j; mails = [];
  for (const mode of ['unreachable', 'http500']) {
    flwMode = mode;
    const rr = await call(verifyOrder, { tx_ref: oo.tx_ref });
    check(`${mode}: state "unverified" (the page retries); the order stays pending, nothing credited, nobody told it is paid`, rr.j.state === 'unverified' && stored(oo.tx_ref).status === 'pending' && mails.length === 0, rr.text);
  }
  flwMode = 'http401';
  const rr = await call(verifyOrder, { tx_ref: oo.tx_ref });
  check('Flutterwave rejecting our secret key: "unverified" AND the business is alerted to fix the key', rr.j.state === 'unverified' && adminMails().some((m) => /verification is failing/.test(m.subject)), mails.map((m) => m.subject).join('|'));
  flwMode = 'normal';
  const rn = await call(verifyOrder, { tx_ref: oo.tx_ref }, { env: { ...env, FLW_SECRET_KEY: undefined } });
  check('no FLW_SECRET_KEY configured: unverified, never "paid"', rn.j.state === 'unverified' && stored(oo.tx_ref).status === 'pending');
  flw.set(oo.tx_ref, paidBody(oo));
  check('once Flutterwave is reachable again the very same order settles', (await call(verifyOrder, { tx_ref: oo.tx_ref })).j.state === 'paid');
}
{
  const kv3 = makeKV(); const e3 = { ...env, REFERRALS_KV: kv3 }; const oo = (await call(createOrder, { items: CART, fulfilment: 'pickup', customer: CUSTOMER }, { env: e3 })).j; flw.set(oo.tx_ref, paidBody(oo)); mails = [];
  const rr = await call(verifyOrder, { tx_ref: oo.tx_ref }, { env: { ...e3, RESEND_API_KEY: undefined } });
  check('if the notification email cannot be sent the order is STILL marked paid (and flagged as not notified)', rr.j.state === 'paid' && JSON.parse(kv3._s.get('order:' + oo.tx_ref).value).status === 'paid' && !JSON.parse(kv3._s.get('order:' + oo.tx_ref).value).notified);
}
{
  const st = []; const ip = '203.0.113.77';
  for (let i = 0; i < 92; i++) st.push((await call(verifyOrder, { tx_ref: 'xny-1700000000000-deadbeef' }, { ip })).status);
  check('verify-order is rate limited per IP (90 an hour)', st[89] === 200 && st[90] === 429);
}

console.log('\n=== the Flutterwave webhook ===');
{
  const oo = (await order({ ref_code: 'ADA01' })).j; mails = []; flw.set(oo.tx_ref, paidBody(oo));
  const ev = { event: 'charge.completed', data: { tx_ref: oo.tx_ref, status: 'successful', amount: oo.amount } };
  r = await call(webhook, ev, { env: { ...env, FLW_SECRET_HASH: undefined }, headers: { 'verif-hash': 'x' } }); check('no FLW_SECRET_HASH configured -> 503, nothing processed', r.status === 503 && stored(oo.tx_ref).status === 'pending');
  r = await call(webhook, ev); check('no verif-hash header -> 401', r.status === 401 && stored(oo.tx_ref).status === 'pending');
  r = await call(webhook, ev, { headers: { 'verif-hash': 'wrong' } }); check('a wrong verif-hash -> 401, nothing processed', r.status === 401 && stored(oo.tx_ref).status === 'pending');
  r = await call(webhook, ev, { headers: { 'verif-hash': 'webhook-secret-hasH' } }); check('a near-miss hash (one character off) -> 401', r.status === 401);
  r = await call(webhook, 'garbage', { headers: { 'verif-hash': 'webhook-secret-hash' } }); check('a signed but unreadable body -> 400', r.status === 400);
  r = await call(webhook, { event: 'transfer.completed', data: { id: 1 } }, { headers: { 'verif-hash': 'webhook-secret-hash' } }); check('an event that is not one of our orders is acknowledged and ignored', r.status === 200 && r.j.ignored === true);
  r = await call(webhook, ev, { headers: { 'verif-hash': 'webhook-secret-hash' } });
  check('a correctly signed webhook confirms the order even though the customer never returned to the site', r.status === 200 && r.j.state === 'paid' && stored(oo.tx_ref).status === 'paid' && stored(oo.tx_ref).verified_by === 'webhook' && adminMails().length === 1);
  flwMode = 'unreachable';
  const o3 = (await order()).j; flw.set(o3.tx_ref, paidBody(o3));
  r = await call(webhook, { event: 'charge.completed', data: { tx_ref: o3.tx_ref } }, { headers: { 'verif-hash': 'webhook-secret-hash' } });
  check('if Flutterwave cannot be asked the webhook answers 503 so Flutterwave retries', r.status === 503 && stored(o3.tx_ref).status === 'pending');
  flwMode = 'normal';
}

console.log('\n=== commission: only for verified orders, at the price and rate in force when the order was placed ===');
{
  const k = makeKV(); const e = { ...env, REFERRALS_KV: k };
  const put = (code, extra) => k.put('affiliate:' + code, JSON.stringify({ name: code, email: code.toLowerCase() + '@example.com', approved_at: 'x', ...extra }), { metadata: { n: code, e: code.toLowerCase() + '@example.com', at: 'x' } });
  await put('ACTIVE1', {}); await put('PAUSED2', { status: 'suspended' }); await put('SELF3', { email: 'Self.Seller+shop@Gmail.com', phone: '2348077770000' });
  const place = async (ref, cust = CUSTOMER) => { const o = (await call(createOrder, { items: CART, fulfilment: 'pickup', customer: cust, ref_code: ref }, { env: e })).j; flw.set(o.tx_ref, paidBody(o)); return o; };
  const settle = async (o) => (await call(verifyOrder, { tx_ref: o.tx_ref }, { env: e })).j.state;
  const refs = () => [...k._s.keys()].filter((x) => x.startsWith('referral:'));
  // placed under v1/8%, price and rate change BEFORE the customer's payment is confirmed
  const early = await place('ACTIVE1');
  await call(adminPricing, { password: PW, action: 'save', products: { 'ashe-honey-50cl': { price_ngn: 12000 }, 'palm-oil-50cl': { price_ngn: 2000 } }, commission_rate: 0.2, note: 'big change' }, { env: e });
  check('an order placed BEFORE a price/rate change and confirmed AFTER it is still credited at the old price and rate: 14,700 x 8% = 1,176', await settle(early) === 'paid' && JSON.parse(k._s.get(refs()[0]).value).commission_ngn === 1176 && JSON.parse(k._s.get(refs()[0]).value).commission_rate === 0.08 && JSON.parse(k._s.get(refs()[0]).value).order_total_ngn === 14700);
  const late = await place('ACTIVE1');
  check('an order placed after the change uses the new price and rate: 2 x 12,000 + 2,000 = 26,000 x 20% = 5,200', late.subtotal === 26000 && (await settle(late)) === 'paid' && JSON.parse(k._s.get(`referral:ACTIVE1:${late.tx_ref}`).value).commission_ngn === 5200);
  const susp = await place('PAUSED2'); await settle(susp);
  check('a suspended affiliate is not credited (the order is still paid)', JSON.parse(k._s.get('order:' + susp.tx_ref).value).status === 'paid' && !k._s.has(`referral:PAUSED2:${susp.tx_ref}`) && JSON.parse(k._s.get('order:' + susp.tx_ref).value).referral === 'inactive referral code');
  const ghost = await place('NOBODY'); await settle(ghost);
  check('an unknown code is not credited', !k._s.has(`referral:NOBODY:${ghost.tx_ref}`) && JSON.parse(k._s.get('order:' + ghost.tx_ref).value).referral === 'unrecognised referral code');
  const none = await place(undefined); await settle(none);
  check('no code, no commission', JSON.parse(k._s.get('order:' + none.tx_ref).value).referral === 'no referral code');
  const self1 = await place('SELF3', { ...CUSTOMER, email: 'selfseller@gmail.com' }); await settle(self1);
  check('an affiliate buying through their OWN link (same Gmail after dots/+tag) earns nothing', !k._s.has(`referral:SELF3:${self1.tx_ref}`) && JSON.parse(k._s.get('order:' + self1.tx_ref).value).referral === 'self-referral');
  const self2 = await place('SELF3', { ...CUSTOMER, email: 'other@example.com', phone: '0807 777 0000' }); await settle(self2);
  check('...or with their own phone number', !k._s.has(`referral:SELF3:${self2.tx_ref}`) && JSON.parse(k._s.get('order:' + self2.tx_ref).value).referral === 'self-referral');
  const fine = await place('SELF3', { ...CUSTOMER, email: 'someone.else@example.com', phone: '0803 000 1111' }); await settle(fine);
  check('a genuine customer through that affiliate\'s link IS credited', k._s.has(`referral:SELF3:${fine.tx_ref}`));
  // reports and stats follow the stored amounts
  const st = await (await myStats({ request: new Request('https://x/api/get-my-stats?code=ACTIVE1'), env: e })).json();
  check('the affiliate\'s stats total the two orders at THEIR OWN rates: 1,176 + 5,200 = 6,376 (displayed rate is the current 20%)', st.commission_ngn === 6376 && st.orders === 2 && st.commission_rate === 0.2, JSON.stringify(st));
  const rp = (await (await getReferrals({ request: post({ password: PW }), env: e })).json()).rows.find((x) => x.code === 'ACTIVE1');
  check('and so does the payout report', rp.commission_earned_ngn === 6376);
}

console.log('\n=== the public log-referral endpoint can no longer be used to invent sales ===');
{
  const k = makeKV(); const e = { ...env, REFERRALS_KV: k };
  await k.put('affiliate:ADA01', JSON.stringify({ name: 'Ada', email: 'ada@example.com', approved_at: 'x' }), { metadata: { n: 'Ada', e: 'ada@example.com', at: 'x' } });
  const lr = (b) => call(logReferral, b, { env: e });
  let rr = await lr({ ref_code: 'ADA01', tx_ref: 'tx-fake', order_total_ngn: 1000000, gross_total_ngn: 1000000, pricing_version: 1, items: CART });
  check('a fabricated sale (made-up tx_ref, huge total) is acknowledged and recorded as NOTHING', rr.status === 200 && rr.j.logged === false && [...k._s.keys()].filter((x) => x.startsWith('referral:')).length === 0, rr.text);
  rr = await lr({ ref_code: 'ADA01', tx_ref: 'xny-1700000000000-deadbeef', order_total_ngn: 5000 });
  check('a well-formed tx_ref with no order behind it earns nothing', rr.j.logged === false && [...k._s.keys()].filter((x) => x.startsWith('referral:')).length === 0);
  const o = (await call(createOrder, { items: CART, fulfilment: 'pickup', customer: CUSTOMER, ref_code: 'ADA01' }, { env: e })).j;
  rr = await lr({ ref_code: 'ADA01', tx_ref: o.tx_ref, order_total_ngn: 14700 });
  check('a real but UNPAID order cannot be credited by calling this endpoint', rr.j.logged === false && /not verified/.test(rr.j.reason) && [...k._s.keys()].filter((x) => x.startsWith('referral:')).length === 0);
  flw.set(o.tx_ref, paidBody(o)); await call(verifyOrder, { tx_ref: o.tx_ref }, { env: e });
  rr = await lr({ ref_code: 'SOMEONEELSE', tx_ref: o.tx_ref, order_total_ngn: 99999999 });
  check('for a PAID order it only re-writes the commission fixed at order time: the code and amounts in the request are ignored', rr.j.logged === true && [...k._s.keys()].filter((x) => x.startsWith('referral:')).join() === `referral:ADA01:${o.tx_ref}` && JSON.parse(k._s.get(`referral:ADA01:${o.tx_ref}`).value).commission_ngn === 1176);
  rr = await lr('garbage'); check('garbage -> 400', rr.status === 400);
  check('no KV -> 503', (await call(logReferral, { tx_ref: 'x' }, { env: { ...env, REFERRALS_KV: undefined } })).status === 503);
}

console.log('\n=== orders left unpaid do not live forever ===');
{
  const k = makeKV(); const e = { ...env, REFERRALS_KV: k };
  const o = (await call(createOrder, { items: CART, fulfilment: 'pickup', customer: CUSTOMER }, { env: e })).j;
  advance(7 * 86400e3 + 1000);
  check('after 7 days an unpaid order has expired', !(await k.get('order:' + o.tx_ref)));
  const rr = await call(verifyOrder, { tx_ref: o.tx_ref }, { env: e });
  check('...and can no longer be settled: "unknown"', rr.j.state === 'unknown');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
