/**
 * Tests for payout receipts (email), the WhatsApp/SMS message data, phone
 * normalisation and the affiliate-facing payment history.
 *
 *   node tests/payout-receipts.test.mjs
 *
 * No dependencies, no network: KV and Resend are mocked in memory, so this
 * checks exactly what WOULD be sent. It cannot tell you how Gmail will render
 * the email; for that, record a test payment to a test affiliate.
 */
import { onRequestPost as recordPayout } from '../functions/api/record-payout.js';
import { onRequestPost as report } from '../functions/api/get-referrals.js';
import { onRequestGet as myStats } from '../functions/api/get-my-stats.js';
import { buildReceiptEmail } from '../functions/_lib/receipt.js';
import { normalisePhone, last4, formatNgn, formatDate, firstName, buildReceiptMessage } from '../functions/_lib/payouts.js';

function makeKV() {
  const s = new Map();
  return { _s: s,
    async put(k, v, o = {}) { s.set(k, { value: v, metadata: o.metadata ?? null }); },
    async get(k) { return s.has(k) ? s.get(k).value : null; },
    async delete(k) { s.delete(k); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const all = [...s.keys()].filter(k => k.startsWith(prefix)).sort();
      const st = cursor ? Number(cursor) : 0, sl = all.slice(st, st + limit), n = st + limit;
      return { keys: sl.map(name => ({ name, metadata: s.get(name).metadata })), cursor: n < all.length ? String(n) : undefined, list_complete: n >= all.length }; } };
}
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, x)); };
const post = b => new Request('https://x/api', { method: 'POST', body: JSON.stringify(b) });

// ---- mock Resend (global fetch) ----
let calls = [];
let resendReply = () => new Response(JSON.stringify({ id: 're_receipt1' }), { status: 200 });
globalThis.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return resendReply(); };

const PW = 'admin-pw';
const KV = makeKV();
const env = { REFERRALS_KV: KV, ADMIN_REPORT_PASSWORD: PW, RESEND_API_KEY: 're_test_SECRET_KEY' };
const call = async (fn, body, e = env) => { const r = await fn({ request: post(body), env: e }); return { status: r.status, j: await r.json() }; };
const stats = async code => { const r = await myStats({ request: new Request('https://x/api/get-my-stats?code=' + code), env }); return { status: r.status, j: await r.json() }; };

console.log('=== phone normalisation ===');
for (const [input, want] of [
  ['08012345678', '2348012345678'],
  ['0801 234 5678', '2348012345678'],
  ['0801-234-5678', '2348012345678'],
  ['(0801) 234 5678', '2348012345678'],
  ['0801.234.5678', '2348012345678'],
  ['+2348012345678', '2348012345678'],
  ['+234 801 234 5678', '2348012345678'],
  ['+234-801-234-5678', '2348012345678'],
  ['2348012345678', '2348012345678'],
  ['234 801 234 5678', '2348012345678'],
  ['00234 801 234 5678', '2348012345678'],
  ['  08012345678  ', '2348012345678'],
  ['0801234567', null],        // 10 digits: too short
  ['080123456789', null],      // 12 digits
  ['234801234567', null],      // 12 digits
  ['23480123456789', null],    // 14 digits
  ['8012345678', null],        // no leading 0 or 234
  ['12345678901', null],       // 11 digits but not 0…
  ['+1 555 123 4567', null],   // not Nigerian
  ['0801 234 56x8', null],     // a letter
  ['', null], ['   ', null], ['+', null], [null, null], [undefined, null], [8012345678, null], [{}, null]
]) {
  const got = normalisePhone(input);
  check(`normalisePhone(${JSON.stringify(input)}) -> ${JSON.stringify(want)}`, got === want, JSON.stringify(got));
}

console.log('\n=== formatting helpers ===');
check('last4', last4('0123456789') === '6789' && last4('12 34-5678') === '5678' && last4('123') === '' && last4('') === '' && last4(null) === '');
check('formatNgn', formatNgn(1500) === '₦1,500' && formatNgn(1500.5) === '₦1,500.50' && formatNgn(0) === '₦0' && formatNgn(1234567.89) === '₦1,234,567.89' && formatNgn(999.999) === '₦1,000');
check('formatDate (no day shift)', formatDate('2026-05-10') === '10 May 2026' && formatDate('2026-01-01T23:59:59.000Z') === '1 Jan 2026' && formatDate('nonsense') === '');
check('firstName', firstName('Adebayo Okafor') === 'Adebayo' && firstName('  Ngozi ') === 'Ngozi' && firstName('') === 'there');
const msg = buildReceiptMessage({ name: 'Adebayo Okafor', amount: 1500.5, bankName: 'GTBank', last4: '4821', paidOn: '2026-05-10', reference: 'FLW-1', paidToDate: 2000, balanceDue: 2800, statsLink: 'https://xnyfarms.com/my-stats.html?code=ADEBAYO01' });
check('WhatsApp/SMS message text', msg === 'Hello Adebayo, XNY Farms has paid ₦1,500.50 commission to your GTBank account ending 4821 on 10 May 2026. Ref: FLW-1. Total paid to date: ₦2,000. Balance due: ₦2,800. Check your earnings: https://xnyfarms.com/my-stats.html?code=ADEBAYO01 Thank you for partnering with us.', msg);
check('message without a reference drops the "Ref:" sentence; no bank still reads well',
  !/Ref:/.test(buildReceiptMessage({ name: 'A', amount: 5, bankName: '', last4: '', paidOn: '2026-05-10', reference: '', paidToDate: 5, balanceDue: 0, statsLink: 'x' })) &&
  /to your bank account on 10 May 2026/.test(buildReceiptMessage({ name: 'A', amount: 5, bankName: '', last4: '', paidOn: '2026-05-10', reference: '', paidToDate: 5, balanceDue: 0, statsLink: 'x' })));
check('no full stop directly after the link (chat apps would swallow it into the URL)', !/code=ADEBAYO01\./.test(msg));

// ---- fixtures ----
const FULL_ACCOUNT = '0123454821';
const putApp = (key, v) => KV.put(key, JSON.stringify(v), { metadata: { s: v.status, n: v.name } });
await putApp('application:2026-01-01T00:00:00.000Z-aaaa', { name: 'Adebayo Okafor', email: 'ade@example.com', phone: '0801 111 2222', bank_name: 'GTBank', account_number: FULL_ACCOUNT, account_holder: 'Adebayo Okafor', status: 'approved' });
await KV.put('affiliate:ADEBAYO01', JSON.stringify({ name: 'Adebayo Okafor', email: 'ade@example.com', approved_at: '2026-03-01T00:00:00.000Z', application_key: 'application:2026-01-01T00:00:00.000Z-aaaa' }), { metadata: { n: 'Adebayo Okafor', e: 'ade@example.com', at: '2026-03-01T00:00:00.000Z', k: 'application:2026-01-01T00:00:00.000Z-aaaa' } });
await KV.put('affiliate:NOPHONE2', JSON.stringify({ name: 'No Phone', email: 'nophone@example.com', approved_at: '2026-03-01T00:00:00.000Z' }), { metadata: { n: 'No Phone', e: 'nophone@example.com', at: '2026-03-01T00:00:00.000Z' } });
await putApp('application:2026-01-02T00:00:00.000Z-bbbb', { name: 'No Phone', email: 'nophone@example.com', phone: '12345', bank_name: 'Access', account_number: '9876543210', account_holder: 'No Phone', status: 'approved' });
await KV.put('affiliate:BADMAIL3', JSON.stringify({ name: 'Bad Mail', email: 'not-an-email', approved_at: '2026-03-01T00:00:00.000Z' }), { metadata: { n: 'Bad Mail', e: 'not-an-email', at: '2026-03-01T00:00:00.000Z' } });
await KV.put('affiliate:HOSTILE4', JSON.stringify({ name: '<script>alert(1)</script> Eve', email: 'eve@example.com', approved_at: '2026-03-01T00:00:00.000Z' }), { metadata: { n: 'x', e: 'eve@example.com', at: '2026-03-01T00:00:00.000Z' } });
const putOrder = (c, tx, total, ts) => KV.put(`referral:${c}:${tx}`, JSON.stringify({ ref_code: c, tx_ref: tx, order_total_ngn: total, commission_ngn: total * 0.08, timestamp: ts }), { metadata: { c, t: total, m: Math.round(total * 8) / 100, ts } });
await putOrder('ADEBAYO01', 'tx1', 50000, '2026-05-01T10:00:00.000Z');   // earned 4,000
await putOrder('ADEBAYO01', 'tx2', 25000, '2026-05-02T10:00:00.000Z');   // earned 2,000  -> 6,000
await putOrder('NOPHONE2', 'tn1', 10000, '2026-05-03T10:00:00.000Z');    // 800
await putOrder('BADMAIL3', 'tb1', 10000, '2026-05-03T10:00:00.000Z');
await putOrder('HOSTILE4', 'th1', 10000, '2026-05-03T10:00:00.000Z');

const good = { password: PW, code: 'ADEBAYO01', amount_ngn: 1500.5, paid_on: '2026-05-10', reference: 'FLW-TRF-777', note: 'first part', email_receipt: true };
const payoutKeys = () => [...KV._s.keys()].filter(k => k.startsWith('payout:'));

console.log('\n=== payout saved when the email succeeds ===');
let r = await call(recordPayout, good);
check('ok, recorded and notified', r.status === 200 && r.j.ok && r.j.recorded === true && r.j.notified === true && r.j.email_requested === true && !('error' in r.j), JSON.stringify(r.j));
check('exactly one Resend call', calls.length === 1);
const sent = calls[0].body; const key1 = r.j.key;
check('sent to Resend with the bearer key', calls[0].url === 'https://api.resend.com/emails' && calls[0].init.headers.Authorization === 'Bearer re_test_SECRET_KEY');
check('from the verified sender, reply-to the monitored inbox', sent.from === 'XNY Farms <affiliates@xnyfarms.com>' && sent.reply_to === 'xnyfarms@gmail.com');
check('subject names the amount', sent.subject === 'Your XNY Farms commission payment of ₦1,500.50', sent.subject);
check('payout is stored with metadata still exactly { c, a, ts }', JSON.stringify(KV._s.get(key1).metadata) === JSON.stringify({ c: 'ADEBAYO01', a: 1500.5, ts: '2026-05-10' }), JSON.stringify(KV._s.get(key1).metadata));
const v1 = JSON.parse(KV._s.get(key1).value);
check('value records notified_email { at, ok:true, error:"" }', v1.notified_email && v1.notified_email.ok === true && v1.notified_email.error === '' && !Number.isNaN(Date.parse(v1.notified_email.at)), JSON.stringify(v1.notified_email));
check('value still carries amount/reference/note', v1.amount_ngn === 1500.5 && v1.reference === 'FLW-TRF-777' && v1.note === 'first part');
check('API key never in the response or the email', !JSON.stringify(r.j).includes('SECRET_KEY') && !JSON.stringify(sent).includes('SECRET_KEY'));

console.log('\n=== what the receipt says ===');
check('recipient is the email on file in KV', JSON.stringify(sent.to) === JSON.stringify(['ade@example.com']));
check('greets by first name', /Hi Adebayo,/.test(sent.html) && /Hi Adebayo,/.test(sent.text));
check('shows amount, date, reference and note', ['₦1,500.50', '10 May 2026', 'FLW-TRF-777', 'first part'].every(t => sent.html.includes(t) && sent.text.includes(t)));
check('running totals computed from KV: earned ₦6,000, paid ₦1,500.50 (including this one), balance ₦4,499.50',
  sent.text.includes('Total commission earned: ₦6,000') && sent.text.includes('Total paid to date (including this payment): ₦1,500.50') && sent.text.includes('Balance still due: ₦4,499.50') &&
  sent.html.includes('₦6,000') && sent.html.includes('₦4,499.50'), sent.text);
check('destination is bank name + last 4 only', sent.text.includes('Paid to: GTBank account ending 4821') && sent.html.includes('GTBank account ending 4821'));
const wire = JSON.stringify(sent);
check('the FULL account number appears nowhere (subject, html, text)', !wire.includes(FULL_ACCOUNT) && !wire.includes('0123454821') && !/0123/.test(wire.replace(/0123456789/g, '')) , '');
check('not even an unbroken run of the first six digits', !wire.includes('012345'));
check('account holder / phone are not in the email either', !wire.includes('0801 111 2222') && !wire.includes('2348011112222'));
check('button "View My Earnings" -> my-stats.html?code=ADEBAYO01', /href="https:\/\/xnyfarms\.com\/my-stats\.html\?code=ADEBAYO01"[^>]*class="btn-link"/.test(sent.html) && /View My Earnings/.test(sent.html));
check('plain text carries the stats link, the reply line and the X link', sent.text.includes('https://xnyfarms.com/my-stats.html?code=ADEBAYO01') && /reply to this email or write to xnyfarms@gmail\.com/.test(sent.text) && sent.text.includes('https://x.com/xnyfarms'));
check('html has the reply line and the signature', /reply to this email or write to <a href="mailto:xnyfarms@gmail\.com"/.test(sent.html) && sent.html.includes('+234 806 013 8299') && sent.html.includes('Follow us on X') && sent.html.includes('https://x.com/xnyfarms'));
check('no script / svg in the email', !/<script|<svg/i.test(sent.html));

console.log('\n=== recipient and totals cannot come from the request ===');
calls = [];
r = await call(recordPayout, { ...good, amount_ngn: 100, email: 'attacker@evil.com', to: 'attacker@evil.com', phone: '08000000000', name: 'Mallory', paid_ngn: 99999, balance_due_ngn: 0, earned_ngn: 1, account_number: '1111111111', link: 'https://evil.example' });
const s2 = calls[0].body;
check('"email"/"to"/"phone"/"name"/"link" in the request are all ignored', JSON.stringify(s2.to) === JSON.stringify(['ade@example.com']) && !JSON.stringify(s2).includes('evil') && !JSON.stringify(s2).includes('Mallory') && !s2.text.includes('1111111111'));
check('client-supplied totals are ignored: paid = 1,500.50 + 100, balance = 4,399.50', s2.text.includes('Total paid to date (including this payment): ₦1,600.50') && s2.text.includes('Balance still due: ₦4,399.50') && s2.text.includes('Total commission earned: ₦6,000'), s2.text);

console.log('\n=== totals include the new payout even if KV list() has not caught up ===');
{
  const lagging = { ...KV, list: async (o) => { const page = await KV.list(o); return { ...page, keys: page.keys.filter(k => !k.name.includes('LAGGY')) }; } };
  const lagEnv = { ...env, REFERRALS_KV: lagging };
  // make this payout's key invisible to list(): keys embed a timestamp, so fake the clock into a marker via the note? simpler: wrap put to rename nothing, hide by reference.
  const hidden = { ...KV, list: async (o) => { const page = await KV.list(o); return { ...page, keys: page.keys.filter(k => !(k.metadata && k.metadata.a === 777.77)) }; } };
  calls = [];
  const rr = await recordPayout({ request: post({ ...good, code: 'NOPHONE2', amount_ngn: 777.77, reference: 'LAGGY' }), env: { ...env, REFERRALS_KV: hidden } });
  const jj = await rr.json();
  check('recorded and emailed', jj.ok && jj.notified === true, JSON.stringify(jj));
  check('receipt total still includes the payout list() could not see (₦777.77 paid, balance ₦22.23)', calls[0].body.text.includes('Total paid to date (including this payment): ₦777.77') && calls[0].body.text.includes('Balance still due: ₦22.23'), calls[0].body.text);
}

console.log('\n=== payout saved when the email fails ===');
calls = [];
resendReply = () => new Response(JSON.stringify({ statusCode: 403, name: 'validation_error', message: 'The xnyfarms.com domain is not verified.' }), { status: 403 });
const before = payoutKeys().length;
r = await call(recordPayout, { ...good, amount_ngn: 250, reference: 'FAILCASE' });
check('ok:true, recorded:true, notified:false, error says why', r.status === 200 && r.j.ok === true && r.j.recorded === true && r.j.notified === false && /domain is not verified/.test(r.j.error), JSON.stringify(r.j));
check('...and the payout IS in KV', payoutKeys().length === before + 1 && KV._s.has(r.j.key) && JSON.parse(KV._s.get(r.j.key).value).amount_ngn === 250);
const failedKey = r.j.key;
const vf = JSON.parse(KV._s.get(failedKey).value);
check('notified_email = { ok:false, error } on the record; metadata still { c, a, ts }', vf.notified_email.ok === false && /domain is not verified/.test(vf.notified_email.error) && JSON.stringify(KV._s.get(failedKey).metadata) === JSON.stringify({ c: 'ADEBAYO01', a: 250, ts: '2026-05-10' }), JSON.stringify(vf.notified_email));
resendReply = () => { throw new TypeError('network down'); };
r = await call(recordPayout, { ...good, amount_ngn: 251 });
check('network failure: payout kept, notified:false with a clear error', r.j.ok && r.j.recorded && !r.j.notified && /Could not reach the email service/.test(r.j.error) && KV._s.has(r.j.key), JSON.stringify(r.j));
resendReply = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
r = await call(recordPayout, { ...good, amount_ngn: 252 });
check('timeout: payout kept, error says it took too long', r.j.ok && !r.j.notified && /too long/.test(r.j.error) && KV._s.has(r.j.key));
resendReply = () => new Response(JSON.stringify({ id: 're_receipt1' }), { status: 200 });
r = await call(recordPayout, { ...good, amount_ngn: 253 }, { ...env, RESEND_API_KEY: undefined });
check('no RESEND_API_KEY: payout kept, error names the variable', r.j.ok && r.j.recorded && !r.j.notified && /RESEND_API_KEY/.test(r.j.error) && KV._s.has(r.j.key), JSON.stringify(r.j));
r = await call(recordPayout, { ...good, code: 'BADMAIL3', amount_ngn: 10 });
check('invalid email on file: payout kept, says so', r.j.ok && r.j.recorded && !r.j.notified && /isn't valid/.test(r.j.error) && KV._s.has(r.j.key), JSON.stringify(r.j));

console.log('\n=== not requested -> nothing sent ===');
calls = [];
r = await call(recordPayout, { ...good, amount_ngn: 11, email_receipt: false });
check('no Resend call, notified:false, email_requested:false, no error', calls.length === 0 && r.j.ok && r.j.notified === false && r.j.email_requested === false && !('error' in r.j));
check('no notified_email stored', !('notified_email' in JSON.parse(KV._s.get(r.j.key).value)));
r = await call(recordPayout, { ...good, amount_ngn: 12, email_receipt: undefined }); check('absent flag = not requested', calls.length === 0 && r.j.email_requested === false);
r = await call(recordPayout, { ...good, amount_ngn: 13, email_receipt: 'true' }); check('only boolean true counts (a string "true" does not)', calls.length === 0 && r.j.email_requested === false);
r = await call(recordPayout, { ...good, code: 'NOSUCH1', email_receipt: true }); check('unknown affiliate: 404 and no email', r.status === 404 && calls.length === 0);

console.log('\n=== resend a receipt ===');
calls = [];
const lookKey = failedKey;
const rawBefore = JSON.parse(KV._s.get(lookKey).value), metaBefore = JSON.stringify(KV._s.get(lookKey).metadata);
r = await call(recordPayout, { password: PW, payout_key: lookKey });
check('resend succeeds', r.status === 200 && r.j.ok && r.j.notified === true && calls.length === 1, JSON.stringify(r.j));
const rawAfter = JSON.parse(KV._s.get(lookKey).value);
check('record now says notified ok:true; nothing else on it changed; metadata unchanged',
  rawAfter.notified_email.ok === true && rawAfter.amount_ngn === rawBefore.amount_ngn && rawAfter.reference === rawBefore.reference && rawAfter.recorded_at === rawBefore.recorded_at && JSON.stringify(KV._s.get(lookKey).metadata) === metaBefore);
check('resend goes to the KV email and carries this payout (₦250)', JSON.stringify(calls[0].body.to) === JSON.stringify(['ade@example.com']) && calls[0].body.subject.includes('₦250') && calls[0].body.text.includes('FAILCASE'));
calls = [];
r = await call(recordPayout, { password: PW, payout_key: lookKey, email: 'attacker@evil.com' });
check('a request-supplied email is ignored on resend too', JSON.stringify(calls[0].body.to) === JSON.stringify(['ade@example.com']));
calls = [];
for (const bad of ['affiliate:ADEBAYO01', 'referral:ADEBAYO01:tx1', 'application:2026-01-01T00:00:00.000Z-aaaa', 'PAYOUT:ADEBAYO01:x', '', 'x payout:', 5, null, ['payout:a'], 'payout:' + 'a'.repeat(300)]) {
  r = await call(recordPayout, { password: PW, payout_key: bad });
  check(`payout_key ${JSON.stringify(bad)?.slice(0, 30)} -> 400, nothing sent`, r.status === 400 && calls.length === 0, r.status);
}
r = await call(recordPayout, { password: PW, payout_key: 'payout:ADEBAYO01:never-existed' }); check('missing payout -> 404, nothing sent', r.status === 404 && calls.length === 0);
r = await call(recordPayout, { password: 'nope', payout_key: lookKey }); check('wrong password -> 401, nothing sent', r.status === 401 && calls.length === 0);
r = await call(recordPayout, { password: PW, payout_key: lookKey, delete_key: lookKey }); check('delete_key + payout_key together -> 400 and nothing deleted', r.status === 400 && KV._s.has(lookKey) && calls.length === 0);
resendReply = () => new Response(JSON.stringify({ message: 'quota exceeded' }), { status: 429 });
r = await call(recordPayout, { password: PW, payout_key: lookKey });
check('resend failing -> 502, notified:false, the reason; record updated to ok:false', r.status === 502 && r.j.ok === false && r.j.notified === false && /quota exceeded/.test(r.j.error) && JSON.parse(KV._s.get(lookKey).value).notified_email.ok === false);
resendReply = () => new Response(JSON.stringify({ id: 're_x' }), { status: 200 });

console.log('\n=== deleting a payout sends nothing ===');
calls = [];
r = await call(recordPayout, { password: PW, delete_key: lookKey });
check('deleted, and no email', r.j.ok && !KV._s.has(lookKey) && calls.length === 0);

console.log('\n=== hostile data is escaped in the receipt ===');
calls = [];
r = await call(recordPayout, { ...good, code: 'HOSTILE4', amount_ngn: 20, reference: '<img src=x onerror=alert(1)>', note: '"><a href="https://evil.example">x</a>' });
const h = calls[0].body.html;
check('name, reference and note are escaped, not live markup', !h.includes('<img src=x') && !h.includes('<script>alert') && !h.includes('<a href="https://evil.example"') && h.includes('&lt;img src=x') && h.includes('&lt;script&gt;'), '');
check('still only the legitimate links (view earnings, mailto, X)', [...h.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map(m => m[1]).sort().join() === ['https://x.com/xnyfarms', 'https://xnyfarms.com/my-stats.html?code=HOSTILE4', 'mailto:xnyfarms@gmail.com'].sort().join());

console.log('\n=== receipt buttons: white text on a DARK fill (Gmail dark mode) ===');
const lum = hex => { const n = parseInt(hex.slice(1), 16); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const demo = buildReceiptEmail({ name: 'Adebayo Okafor', code: 'ADEBAYO01', amount: 1500.5, paidOn: '2026-05-10', reference: 'R', note: '', bankName: 'GTBank', last4: '4821', earned: 6000, paidToDate: 1500.5, balanceDue: 4499.5 });
const cells = [...demo.html.matchAll(/<td\b([^>]*class="btn-cell"[^>]*)>([\s\S]*?)<\/td>/g)].map(m => ({ fill: (/bgcolor="(#[0-9a-f]{6})"/.exec(m[1]) || [])[1], a: (/<a\b[^>]*class="btn-link"[^>]*style="([^"]*)"/.exec(m[2]) || [])[1], span: (/<span class="btn-text" style="([^"]*)"/.exec(m[2]) || [])[1], label: m[2].replace(/<[^>]+>/g, '').trim() }));
check('two buttons: View My Earnings and Follow us on X', cells.length === 2 && cells[0].label === 'View My Earnings' && /Follow us on X/.test(cells[1].label), JSON.stringify(cells.map(c => c.label)));
for (const c of cells) {
  check(`"${c.label}": #ffffff !important on the <a> and the <span>`, /(?:^|;)color:#ffffff !important/.test(c.a) && /(?:^|;)color:#ffffff !important/.test(c.span), c.a);
  check(`"${c.label}": fill ${c.fill} is dark (luminance ${lum(c.fill).toFixed(3)} < 0.2), contrast ${contrast('#ffffff', c.fill).toFixed(1)}:1 >= 7`, lum(c.fill) < 0.2 && contrast('#ffffff', c.fill) >= 7);
}
check('View My Earnings is white on dark green #0b4124', cells[0].fill === '#0b4124');
check('no dark text on any coloured fill: banner heading is white on #06552a', /bgcolor="#06552a"[^>]*>\s*<h1[^>]*color:#ffffff/.test(demo.html));
check('no yellow anywhere as a fill or text colour', !/#dad905/i.test(demo.html));
check('color-scheme metas and the dark-mode backstop', /<meta name="color-scheme" content="light dark">/.test(demo.html) && /prefers-color-scheme: dark[\s\S]*\.btn-text\s*\{\s*color:\s*#ffffff !important/.test(demo.html));
check('plain-text alternative has no markup', !/<|style=/.test(demo.text));

console.log('\n=== get-referrals detail: status + message data for the buttons ===');
r = await call(report, { password: PW, code: 'ADEBAYO01' });
const pd = r.j.payouts_detail;
check('detail returns the payments newest first, with notified_email and message', r.j.ok && pd.length >= 2 && pd.every(p => 'notified_email' in p && typeof p.message === 'string'), JSON.stringify(Object.keys(pd[0] || {})));
check('a payment emailed OK shows { ok:true }; one never emailed shows null', pd.some(p => p.notified_email && p.notified_email.ok === true) && pd.some(p => p.notified_email === null));
check('contact.phone_international is normalised from the APPLICATION phone ("0801 111 2222")', r.j.contact.phone_international === '2348011112222' && r.j.contact.has_phone === true && r.j.contact.has_email === true, JSON.stringify(r.j.contact));
const m1 = pd.find(p => p.amount_ngn === 1500.5).message;
const sumNow = r.j.summary;
check('message: first name, bank, LAST FOUR only, date, ref, totals computed server-side, stats link',
  m1.startsWith('Hello Adebayo, XNY Farms has paid ₦1,500.50 commission to your GTBank account ending 4821 on 10 May 2026. Ref: FLW-TRF-777. ') &&
  m1.includes(`Total paid to date: ${formatNgn(sumNow.paid_ngn)}.`) && m1.includes(`Balance due: ${formatNgn(sumNow.balance_due_ngn)}.`) && m1.includes('https://xnyfarms.com/my-stats.html?code=ADEBAYO01'), m1);
check('no full account number anywhere in the detail response', !JSON.stringify(r.j).includes(FULL_ACCOUNT) && !JSON.stringify(r.j).includes('012345'));
r = await call(report, { password: PW, code: 'NOPHONE2' });
check('an invalid phone ("12345") gives phone_international:null (buttons disabled) but has_phone:true', r.j.contact.phone_international === null && r.j.contact.has_phone === true, JSON.stringify(r.j.contact));
r = await call(report, { password: PW, code: 'HOSTILE4' });
check('an affiliate with no application at all: no phone, no bank in the message', r.j.contact.phone_international === null && r.j.contact.has_phone === false && r.j.payouts_detail.every(p => /to your bank account on/.test(p.message)), JSON.stringify(r.j.payouts_detail.map(p => p.message)));
r = await call(report, { password: PW });
check('the main LISTING carries no message or receipt status', !JSON.stringify(r.j).includes('notified_email') && !JSON.stringify(r.j).includes('Hello '));
r = await call(report, { password: 'nope', code: 'ADEBAYO01' }); check('detail is still password-gated', r.status === 401);

console.log('\n=== affiliate-facing: get-my-stats payments, no private data ===');
await call(recordPayout, { ...good, amount_ngn: 300, paid_on: '2026-06-01', reference: 'LATEST', note: 'PRIVATE NOTE', email_receipt: false });
const st = await stats('adebayo01');
check('payments listed newest first with date, amount, reference', st.j.ok && Array.isArray(st.j.payments) && st.j.payments.length >= 3 && st.j.payments[0].paid_on === '2026-06-01' && st.j.payments[0].amount_ngn === 300 && st.j.payments[0].reference === 'LATEST' &&
  st.j.payments.every((p, i, a) => i === 0 || a[i - 1].paid_on >= p.paid_on), JSON.stringify(st.j.payments));
check('each payment has ONLY paid_on, amount_ngn, reference', st.j.payments.every(p => JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['amount_ngn', 'paid_on', 'reference'])));
const pub = JSON.stringify(st.j);
for (const secret of [FULL_ACCOUNT, '4821', 'GTBank', 'Adebayo Okafor', 'ade@example.com', '0801', '2348011112222', 'PRIVATE NOTE', 'first part', 'notified', 're_receipt1', 'application:', 'payout:', 'Hello ']) {
  check(`get-my-stats never mentions ${JSON.stringify(secret)}`, !pub.includes(secret), pub.slice(0, 200));
}
check('response keys', JSON.stringify(Object.keys(st.j).sort()) === JSON.stringify(['approved', 'balance_due_ngn', 'code', 'commission_ngn', 'commission_rate', 'generated_at', 'last_order_at', 'ok', 'orders', 'paid_ngn', 'payments', 'total_sales_ngn']));
const readKeys = []; const spy = { ...KV, get: async k => { readKeys.push(k); return KV.get(k); } };
await myStats({ request: new Request('https://x/api/get-my-stats?code=ADEBAYO01'), env: { REFERRALS_KV: spy } });
check('get-my-stats never reads an application: record (where bank and phone live)', !readKeys.some(k => k.startsWith('application:')), readKeys.join());
{
  const many = makeKV();
  for (let i = 0; i < 80; i++) { const k = `payout:MANY0001:2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z-aaaaaaaa${String(i).padStart(2, '0')}`; await many.put(k, JSON.stringify({ code: 'MANY0001', amount_ngn: 1, paid_on: '2026-01-' + String(i % 28 + 1).padStart(2, '0'), reference: 'r' + i }), { metadata: { c: 'MANY0001', a: 1, ts: '2026-01-' + String(i % 28 + 1).padStart(2, '0') } }); }
  let gets = 0; const counting = { ...many, get: async k => { gets++; return many.get(k); } };
  const rr = await myStats({ request: new Request('https://x/api/get-my-stats?code=MANY0001'), env: { REFERRALS_KV: counting } }); const jj = await rr.json();
  check(`public endpoint reads at most 50 payout values for references (read ${gets} for 80 payments)`, jj.paid_ngn === 80 && jj.payments.length === 80 && gets <= 50 + 1, gets);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
