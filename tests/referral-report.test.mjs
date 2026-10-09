/**
 * Tests for the payout report: get-referrals, record-payout, the
 * application_key link in register-affiliate, and get-my-stats.
 *
 *   node tests/referral-report.test.mjs
 *
 * No dependencies, no network: KV is an in-memory mock.
 */
import { onRequestPost as report } from '../functions/api/get-referrals.js';
import { onRequestPost as recordPayout } from '../functions/api/record-payout.js';
import { onRequestPost as registerAff } from '../functions/api/register-affiliate.js';
import { onRequestGet as myStats } from '../functions/api/get-my-stats.js';

function makeKV() {
  const s = new Map(); const reads = { get: 0, list: 0 };
  return { _s: s, reads,
    async put(k, v, o = {}) { s.set(k, { value: v, metadata: o.metadata ?? null }); },
    async get(k) { reads.get++; return s.has(k) ? s.get(k).value : null; },
    async delete(k) { s.delete(k); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) { reads.list++;
      const all = [...s.keys()].filter(k => k.startsWith(prefix)).sort();
      const st = cursor ? Number(cursor) : 0, sl = all.slice(st, st + limit), n = st + limit;
      return { keys: sl.map(name => ({ name, metadata: s.get(name).metadata })), cursor: n < all.length ? String(n) : undefined, list_complete: n >= all.length }; } };
}
const post = b => new Request('https://x/api', { method: 'POST', body: JSON.stringify(b) });
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, x)); };
const PW = 'admin-pw';
const KV = makeKV();
const env = { REFERRALS_KV: KV, ADMIN_REPORT_PASSWORD: PW };
const call = async (fn, body, e = env) => { const r = await fn({ request: post(body), env: e }); return { status: r.status, cache: r.headers.get('Cache-Control'), j: await r.json() }; };
const stats = async code => { const r = await myStats({ request: new Request('https://x/api/get-my-stats?code=' + code), env }); return { status: r.status, j: await r.json() }; };

// ---- fixtures ----
const app = (name, email, extra = {}) => ({ name, email, phone: '0800' + name.length, bank_name: 'GTBank', account_number: '0123456789', account_holder: name, status: 'pending', ...extra });
const putApp = (key, v) => KV.put(key, JSON.stringify(v), { metadata: { s: v.status, n: v.name, at: key.slice(12, 36) } });
const putOrder = (code, tx, total, ts) => KV.put(`referral:${code}:${tx}`, JSON.stringify({ ref_code: code, tx_ref: tx, order_total_ngn: total, commission_ngn: Math.round(total * 8) / 100, timestamp: ts }),
  { metadata: { c: code, t: total, m: Math.round(total * 8) / 100, ts } });

await putApp('application:2026-01-01T00:00:00.000Z-aaaa', app('Ada Linked', 'ada@example.com', { bank_name: 'Zenith', account_number: '2000000001' }));
await putApp('application:2026-02-01T00:00:00.000Z-bbbb', app('Bola Old', 'BOLA@Example.com', { bank_name: 'Access', account_number: '3000000002' }));
await putApp('application:2026-03-01T00:00:00.000Z-cccc', app('Bola Newer', 'bola@example.com', { bank_name: 'UBA', account_number: '4000000003' }));   // newest for bola
await putApp('application:2026-01-15T00:00:00.000Z-dddd', app('Someone Else', 'other@example.com', { account_number: '9999999999' }));

console.log('=== register-affiliate stores application_key ===');
let r = await call(registerAff, { password: PW, code: 'ADA01', name: 'Ada Linked', email: 'ada@example.com', application_key: 'application:2026-01-01T00:00:00.000Z-aaaa' });
check('approval succeeds', r.j.ok === true, JSON.stringify(r.j));
const adaRec = JSON.parse(KV._s.get('affiliate:ADA01').value);
check('affiliate record carries application_key', adaRec.application_key === 'application:2026-01-01T00:00:00.000Z-aaaa', JSON.stringify(adaRec));
check('...and the application was marked approved', JSON.parse(KV._s.get('application:2026-01-01T00:00:00.000Z-aaaa').value).status === 'approved');
r = await call(registerAff, { password: PW, code: 'EVIL01', name: 'E', email: 'e@example.com', application_key: 'referral:ADA01:tx1' });
check('a non-application key is NOT stored on the record', !('application_key' in JSON.parse(KV._s.get('affiliate:EVIL01').value)), KV._s.get('affiliate:EVIL01').value);
check('...and the referenced non-application key is untouched', !KV._s.has('referral:ADA01:tx1'));
await KV.delete('affiliate:EVIL01');
// older affiliates: no application_key at all (email fallback)
await KV.put('affiliate:BOLA02', JSON.stringify({ name: 'Bola Okoye', email: 'bola@example.com', approved_at: '2026-03-05T00:00:00.000Z' }), { metadata: { n: 'Bola Okoye', e: 'bola@example.com', at: '2026-03-05T00:00:00.000Z' } });
// no application anywhere
await KV.put('affiliate:NOAPP3', JSON.stringify({ name: 'No App', email: 'noapp@example.com', approved_at: '2026-04-01T00:00:00.000Z' }), { metadata: { n: 'No App', e: 'noapp@example.com', at: '2026-04-01T00:00:00.000Z' } });
// dangling application_key falls back to email
await KV.put('affiliate:DANG04', JSON.stringify({ name: 'Dangling', email: 'other@example.com', approved_at: '2026-04-02T00:00:00.000Z', application_key: 'application:gone' }), { metadata: { n: 'Dangling', e: 'other@example.com', at: '2026-04-02T00:00:00.000Z', k: 'application:gone' } });
// zero-order approved affiliate
await KV.put('affiliate:ZERO05', JSON.stringify({ name: 'Zero Orders', email: 'zero@example.com', approved_at: '2026-04-03T00:00:00.000Z' }), { metadata: { n: 'Zero Orders', e: 'zero@example.com', at: '2026-04-03T00:00:00.000Z' } });

// orders: ADA01 = 10,000 + 5,000.10 -> 800 + 400.01 ; BOLA02 = 2,500 -> 200 ; GHOST99 unregistered ; 0.1/0.2-style money
await putOrder('ADA01', 'tx1', 10000, '2026-05-01T10:00:00.000Z');
await putOrder('ADA01', 'tx2', 5000.1, '2026-05-03T10:00:00.000Z');
await putOrder('BOLA02', 'tx3', 2500, '2026-05-02T10:00:00.000Z');
await putOrder('GHOST99', 'tx4', 1000, '2026-05-04T10:00:00.000Z');
await putOrder('ADA010', 'txX', 777, '2026-05-05T10:00:00.000Z');   // a DIFFERENT code that shares a prefix with ADA01
await KV.put('affiliate:ADA010', JSON.stringify({ name: 'Ada Ten', email: 'ten@example.com', approved_at: '2026-04-04T00:00:00.000Z' }), { metadata: { n: 'Ada Ten', e: 'ten@example.com', at: '2026-04-04T00:00:00.000Z' } });

console.log('\n=== record-payout: validation ===');
const good = { password: PW, code: 'ADA01', amount_ngn: 500, paid_on: '2026-05-10', reference: 'FLW-123', note: 'first part' };
r = await call(recordPayout, { ...good, password: 'nope' }); check('wrong password -> 401', r.status === 401);
r = await call(recordPayout, { ...good, password: undefined }); check('no password -> 401', r.status === 401);
r = await call(recordPayout, good, { ...env, ADMIN_REPORT_PASSWORD: undefined }); check('503 without the password env', r.status === 503);
r = await call(recordPayout, good, { ...env, REFERRALS_KV: undefined }); check('503 without KV', r.status === 503);
check('Cache-Control: no-store', r.cache === 'no-store');
r = await call(recordPayout, { ...good, code: 'NOSUCH1' }); check('unknown affiliate code -> 404', r.status === 404 && /No approved affiliate/.test(r.j.error), JSON.stringify(r.j));
check('...and wrote nothing', ![...KV._s.keys()].some(k => k.startsWith('payout:')));
r = await call(recordPayout, { ...good, code: 'a/b' }); check('malformed code -> 400', r.status === 400);
for (const [label, amt] of [['zero', 0], ['negative', -5], ['NaN as null', null], ['string', '500'], ['absurd', 1e12], ['Infinity (as JSON null)', Infinity], ['sub-kobo', 0.001], ['missing', undefined]]) {
  r = await call(recordPayout, { ...good, amount_ngn: amt });
  check(`amount ${label} -> 400`, r.status === 400, r.status);
}
for (const [label, d] of [['not a date', 'yesterday'], ['future', '2099-01-01'], ['ancient', '1999-12-31'], ['impossible day', '2026-02-31'], ['missing', undefined], ['number', 20260510]]) {
  r = await call(recordPayout, { ...good, paid_on: d });
  check(`paid_on ${label} -> 400`, r.status === 400, r.status + ' ' + JSON.stringify(r.j));
}
check('none of the bad requests wrote a payout', ![...KV._s.keys()].some(k => k.startsWith('payout:')));
r = await call(recordPayout, '' );
check('non-object body -> 400', r.status === 400, r.status);

console.log('\n=== record-payout: success and storage shape ===');
r = await call(recordPayout, { ...good, code: 'ada01' });   // lowercase
check('records a payout (code uppercased)', r.status === 200 && r.j.ok && r.j.code === 'ADA01' && /^payout:ADA01:\d{4}-\d\d-\d\dT[\d:.]+Z-[0-9a-f]{10}$/.test(r.j.key), JSON.stringify(r.j));
const stored = KV._s.get(r.j.key);
check('metadata is exactly { c, a, ts }', JSON.stringify(stored.metadata) === JSON.stringify({ c: 'ADA01', a: 500, ts: '2026-05-10' }), JSON.stringify(stored.metadata));
check('value keeps reference and note', JSON.parse(stored.value).reference === 'FLW-123' && JSON.parse(stored.value).note === 'first part');
const firstKey = r.j.key;
r = await call(recordPayout, { ...good, amount_ngn: 100.456, reference: 'x'.repeat(500), note: 'n\u0000\nl'.repeat(200) });
const longRec = JSON.parse(KV._s.get(r.j.key).value);
check('amount rounded to kobo; reference/note length-capped; control chars stripped', longRec.amount_ngn === 100.46 && longRec.reference.length === 80 && longRec.note.length === 300 && !/[\u0000-\u001f]/.test(longRec.note), JSON.stringify(longRec).slice(0, 120));
const secondKey = r.j.key;

console.log('\n=== record-payout: delete_key guard ===');
const before = [...KV._s.keys()].length;
for (const bad of ['affiliate:ADA01', 'referral:ADA01:tx1', 'application:2026-01-01T00:00:00.000Z-aaaa', 'PAYOUT:ADA01:x', '', 'x payout:', 5, 'payout:' + 'a'.repeat(300)]) {
  r = await call(recordPayout, { password: PW, delete_key: bad });
  check(`delete_key ${JSON.stringify(bad).slice(0, 28)} -> 400`, r.status === 400, r.status);
}
check('nothing was deleted by those', [...KV._s.keys()].length === before);
r = await call(recordPayout, { password: 'nope', delete_key: firstKey }); check('delete with wrong password -> 401, kept', r.status === 401 && KV._s.has(firstKey));
r = await call(recordPayout, { password: PW, delete_key: 'payout:ADA01:never-existed' }); check('deleting a missing payout -> 404', r.status === 404);
r = await call(recordPayout, { password: PW, delete_key: secondKey }); check('deletes a payout key', r.j.ok && !KV._s.has(secondKey) && KV._s.has(firstKey), JSON.stringify(r.j));

console.log('\n=== report: access control ===');
r = await call(report, { password: 'nope' }); check('wrong password -> 401', r.status === 401);
r = await call(report, {}); check('no password -> 401', r.status === 401);
r = await call(report, { password: PW }, { ...env, ADMIN_REPORT_PASSWORD: undefined }); check('503 without the env var', r.status === 503);
r = await call(report, { password: PW }); check('Cache-Control: no-store', r.cache === 'no-store');

console.log('\n=== report: rows and balance maths ===');
const rep = r.j; const row = c => rep.rows.find(x => x.code === c);
check('ok + original fields kept', rep.ok && rep.commission_rate === 0.08 && Array.isArray(rep.rows) && rep.totals && 'orders' in rep.totals && 'total_sales_ngn' in rep.totals && 'commission_ngn' in rep.totals);
check('one row per approved affiliate incl. zero-order, plus the unregistered code',
  ['ADA01', 'BOLA02', 'NOAPP3', 'DANG04', 'ZERO05', 'ADA010', 'GHOST99'].every(c => row(c)) && rep.rows.length === 7, rep.rows.map(x => x.code).join());
const ada = row('ADA01');
check('ADA01 orders/sales exclude the lookalike code ADA010', ada.orders === 2 && ada.total_sales_ngn === 15000.1, JSON.stringify(ada));
check('earned = 800 + 400.01 = 1200.01 (kobo-exact)', ada.commission_earned_ngn === 1200.01 && ada.commission_ngn === 1200.01, ada.commission_earned_ngn);
check('paid = 500 (the deleted one is gone), balance = 700.01', ada.paid_ngn === 500 && ada.balance_due_ngn === 700.01 && ada.overpaid === false, JSON.stringify(ada));
check('last_order_at is the newest order', ada.last_order_at === '2026-05-03T10:00:00.000Z');
const zero = row('ZERO05');
check('zero-order affiliate: 0 / 0 / 0, no payout', zero.orders === 0 && zero.commission_earned_ngn === 0 && zero.balance_due_ngn === 0 && zero.last_order_at === null);
check('unregistered code is flagged and has no contact or payout', row('GHOST99').unregistered === true && row('GHOST99').payout === null && row('GHOST99').name === '' && row('ADA01').unregistered === false);
check('sorted by balance due, largest first', rep.rows.every((x, i) => i === 0 || rep.rows[i - 1].balance_due_ngn >= x.balance_due_ngn), rep.rows.map(x => x.balance_due_ngn).join());

console.log('\n=== report: payout details join ===');
check('by application_key', ada.payout && ada.payout.bank_name === 'Zenith' && ada.payout.account_number === '2000000001' && ada.payout.account_holder === 'Ada Linked' && ada.phone === '0800' + 'Ada Linked'.length, JSON.stringify(ada.payout));
check('by email fallback: case-insensitive AND the most recent application wins', row('BOLA02').payout && row('BOLA02').payout.bank_name === 'UBA' && row('BOLA02').payout.account_number === '4000000003', JSON.stringify(row('BOLA02').payout));
check('email fallback also supplies the phone', row('BOLA02').phone === '0800' + 'Bola Newer'.length, row('BOLA02').phone);
check('dangling application_key falls back to the email match', row('DANG04').payout && row('DANG04').payout.account_number === '9999999999', JSON.stringify(row('DANG04').payout));
check('no key and no matching email -> payout: null', row('NOAPP3').payout === null && row('NOAPP3').phone === '', JSON.stringify(row('NOAPP3')));
await putApp('application:2026-06-01T00:00:00.000Z-eeee', { name: 'Blank Bank', email: 'zero@example.com', phone: '1', bank_name: '', account_number: '', account_holder: '', status: 'pending' });
check('an application with no bank fields at all -> payout: null (but phone still shown)', (r = await call(report, { password: PW }), r.j.rows.find(x => x.code === 'ZERO05').payout === null && r.j.rows.find(x => x.code === 'ZERO05').phone === '1'));
// a linked application wins over a newer application with the same email
await putApp('application:2026-07-01T00:00:00.000Z-ffff', app('Ada Impostor', 'ada@example.com', { bank_name: 'Impostor Bank', account_number: '1111111111' }));
r = await call(report, { password: PW });
check('application_key beats a newer same-email application', r.j.rows.find(x => x.code === 'ADA01').payout.bank_name === 'Zenith');

console.log('\n=== report: partial / full / over payment ===');
await call(recordPayout, { ...good, amount_ngn: 700.01, paid_on: '2026-05-20', reference: 'FLW-124' });
r = await call(report, { password: PW });
let a2 = r.j.rows.find(x => x.code === 'ADA01');
check('paid in full -> balance 0, not overpaid', a2.paid_ngn === 1200.01 && a2.balance_due_ngn === 0 && a2.overpaid === false, JSON.stringify(a2));
await call(recordPayout, { ...good, amount_ngn: 50, paid_on: '2026-05-21' });
r = await call(report, { password: PW });
a2 = r.j.rows.find(x => x.code === 'ADA01');
check('overpaid -> balance shown as 0 (never negative), overpaid flag + amount', a2.paid_ngn === 1250.01 && a2.balance_due_ngn === 0 && a2.overpaid === true && a2.overpaid_ngn === 50, JSON.stringify(a2));
await call(recordPayout, { ...good, code: 'BOLA02', amount_ngn: 0.1, paid_on: '2026-05-21' });
await call(recordPayout, { ...good, code: 'BOLA02', amount_ngn: 0.2, paid_on: '2026-05-22' });
r = await call(report, { password: PW });
check('0.1 + 0.2 is exactly 0.3 (kobo arithmetic)', r.j.rows.find(x => x.code === 'BOLA02').paid_ngn === 0.3, r.j.rows.find(x => x.code === 'BOLA02').paid_ngn);
check('BOLA02 balance = 200 - 0.3 = 199.7', r.j.rows.find(x => x.code === 'BOLA02').balance_due_ngn === 199.7);
const t = r.j.totals;
check('totals: affiliates (registered only) / unregistered / active (registered with orders) / orders', t.affiliates === 6 && t.unregistered_codes === 1 && t.active_affiliates === 3 && t.orders === 5, JSON.stringify(t));
check('totals: sales and earned', t.total_sales_ngn === 19277.1 && t.commission_earned_ngn === 1542.17 && t.commission_ngn === t.commission_earned_ngn, JSON.stringify(t));
check('totals: paid = all payouts', t.paid_ngn === 1250.31, t.paid_ngn);
check('totals: balance is the sum of row balances (an overpayment does NOT cancel another debt); overpaid shown apart',
  t.balance_due_ngn === r.j.rows.reduce((s, x) => s + Math.round(x.balance_due_ngn * 100), 0) / 100 && t.overpaid_ngn === 50, JSON.stringify(t));

console.log('\n=== report: detail request ===');
r = await call(report, { password: PW, code: 'ada01' });
check('detail: ok, orders newest first, prefix-scoped (no ADA010 order)', r.j.ok && r.j.orders_detail.length === 2 && r.j.orders_detail[0].tx_ref === 'tx2' && !r.j.orders_detail.some(o => o.tx_ref === 'txX'), JSON.stringify(r.j.orders_detail));
check('detail: order fields', JSON.stringify(Object.keys(r.j.orders_detail[0])) === JSON.stringify(['tx_ref', 'timestamp', 'order_total_ngn', 'commission_ngn']) && r.j.orders_detail[0].commission_ngn === 400.01);
check('detail: payouts newest first with reference and note', r.j.payouts_detail.length === 3 && r.j.payouts_detail[0].paid_on === '2026-05-21' && r.j.payouts_detail[2].reference === 'FLW-123' && r.j.payouts_detail[2].note === 'first part' && /^payout:ADA01:/.test(r.j.payouts_detail[0].key), JSON.stringify(r.j.payouts_detail));
check('detail: summary agrees with the listing', r.j.summary.commission_earned_ngn === 1200.01 && r.j.summary.paid_ngn === 1250.01 && r.j.summary.overpaid === true && r.j.summary.balance_due_ngn === 0);
check('detail: no bank details in it', !JSON.stringify(r.j).includes('2000000001'));
r = await call(report, { password: PW, code: 'ZERO05' }); check('detail for a zero-order affiliate is empty, not an error', r.j.ok && r.j.orders_detail.length === 0 && r.j.payouts_detail.length === 0);
r = await call(report, { password: PW, code: 'bad code!' }); check('detail with a malformed code -> 400', r.status === 400);
r = await call(report, { password: 'x', code: 'ADA01' }); check('detail with the wrong password -> 401', r.status === 401);
// the listing must not read per-order values
const reads0 = KV.reads.get; await call(report, { password: PW }); const listingGets = KV.reads.get - reads0;
check(`listing does NO get() per order or per payout (${listingGets} gets for 6 affiliates: linked/dangling/email lookups only)`, listingGets <= 6 + 2 * 20, listingGets);
// legacy records without metadata still count
await KV.put('referral:ZERO05:legacy1', JSON.stringify({ ref_code: 'ZERO05', tx_ref: 'legacy1', order_total_ngn: 1000, commission_ngn: 80, timestamp: '2026-01-01T00:00:00.000Z' }));
await KV.put('payout:ZERO05:2026-01-02T00:00:00.000Z-aaaaaaaaaa', JSON.stringify({ code: 'ZERO05', amount_ngn: 30, paid_on: '2026-01-02' }));
r = await call(report, { password: PW });
check('metadata-less referral and payout records still count', r.j.rows.find(x => x.code === 'ZERO05').commission_earned_ngn === 80 && r.j.rows.find(x => x.code === 'ZERO05').paid_ngn === 30 && r.j.rows.find(x => x.code === 'ZERO05').balance_due_ngn === 50);

console.log('\n=== get-my-stats: paid / balance, and no leaks ===');
let st = await stats('ada01');
check('returns paid_ngn and balance_due_ngn for that code', st.j.ok && st.j.paid_ngn === 1250.01 && st.j.balance_due_ngn === 0 && st.j.commission_ngn === 1200.01, JSON.stringify(st.j));
st = await stats('BOLA02');
check('partial payment: paid 0.3, balance 199.7', st.j.paid_ngn === 0.3 && st.j.balance_due_ngn === 199.7, JSON.stringify(st.j));
st = await stats('ADA010');
check('a lookalike code does not inherit ADA01\'s payouts', st.j.paid_ngn === 0 && st.j.orders === 1);
const leak = JSON.stringify((await stats('ADA01')).j);
for (const secret of ['2000000001', 'Zenith', 'GTBank', 'Ada Linked', 'ada@example.com', 'first part', '0800', 'application:', 'payout:', 'BOLA02', '9999999999']) {
  check(`get-my-stats never mentions ${JSON.stringify(secret)}`, !leak.includes(secret), leak);
}
check('get-my-stats response has only the expected keys', JSON.stringify(Object.keys((await stats('ADA01')).j).sort()) === JSON.stringify(['approved', 'balance_due_ngn', 'code', 'commission_ngn', 'commission_rate', 'generated_at', 'last_order_at', 'ok', 'orders', 'paid_ngn', 'payments', 'total_sales_ngn']));
const keysRead = []; const spyKV = { ...KV, get: async k => { keysRead.push(k); return KV.get(k); } };
await myStats({ request: new Request('https://x/api/get-my-stats?code=ADA01'), env: { REFERRALS_KV: spyKV } });
check('get-my-stats never reads an application: record', !keysRead.some(k => k.startsWith('application:')), keysRead.join());
st = await stats('NEWCODE9'); check('unknown code: zeros, not an error', st.j.ok && st.j.paid_ngn === 0 && st.j.balance_due_ngn === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
