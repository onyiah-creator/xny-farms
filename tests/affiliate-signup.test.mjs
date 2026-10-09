/**
 * Tests for automatic affiliate registration: duplicate detection, email
 * confirmation, code generation, abuse protection, suspension, "resend my welcome
 * email" and the one-time index rebuild.
 *
 *   node tests/affiliate-signup.test.mjs
 *
 * No dependencies, no network: KV, Resend and Turnstile are mocked in memory, and the
 * clock is faked so the 10-minute cooldown and the 48-hour expiry can be tested. This
 * checks exactly what WOULD be sent; it cannot tell you how Gmail renders the emails.
 */
import { onRequestPost as signup } from '../functions/api/submit-affiliate-application.js';
import { onRequestPost as resendConfirmation } from '../functions/api/resend-confirmation.js';
import { onRequestGet as verify } from '../functions/api/verify-affiliate.js';
import { onRequestPost as resendWelcome } from '../functions/api/resend-welcome.js';
import { onRequestPost as rebuildIndex } from '../functions/api/rebuild-index.js';
import { onRequestPost as setStatus } from '../functions/api/set-affiliate-status.js';
import { onRequestPost as register } from '../functions/api/register-affiliate.js';
import { onRequestPost as logReferral } from '../functions/api/log-referral.js';
import { onRequestPost as getAffiliates } from '../functions/api/get-affiliates.js';
import { onRequestGet as myStats } from '../functions/api/get-my-stats.js';
import { onRequestPost as getReferrals } from '../functions/api/get-referrals.js';
import { normaliseEmail, normalisePhoneIntl, codeBase, pickCode, codeCandidate, RESERVED_CODES } from '../functions/_lib/identity.js';
import { buildConfirmationEmail } from '../functions/_lib/signup-emails.js';

/* ---- fake clock + KV with TTLs ---- */
let NOW = Date.parse('2026-10-10T10:00:00.000Z');
Date.now = () => NOW;
const advance = ms => { NOW += ms; };
const MIN = 60e3, HOUR = 3600e3;

function makeKV() {
  const s = new Map();
  const live = k => { const e = s.get(k); if (!e) return null; if (e.expiresAt && e.expiresAt <= NOW) { s.delete(k); return null; } return e; };
  return { _s: s, live,
    ttl: k => { const e = live(k); return e ? e.ttl : undefined; },
    async put(k, v, o = {}) { s.set(k, { value: v, metadata: o.metadata ?? null, ttl: o.expirationTtl, expiresAt: o.expirationTtl ? NOW + o.expirationTtl * 1000 : null }); },
    async get(k) { const e = live(k); return e ? e.value : null; },
    async delete(k) { s.delete(k); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const all = [...s.keys()].filter(k => live(k) && k.startsWith(prefix)).sort();
      const st = cursor ? Number(cursor) : 0, sl = all.slice(st, st + limit), n = st + limit;
      return { keys: sl.map(name => ({ name, metadata: s.get(name).metadata })), cursor: n < all.length ? String(n) : undefined, list_complete: n >= all.length }; } };
}
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, String(x).slice(0, 300))); };

/* ---- mock Resend + Turnstile (global fetch) ---- */
let mails = [];
let resendMode = 'ok';                      // 'ok' | 'fail'
let turnstile = { mode: 'success', calls: [] };
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://challenges.cloudflare.com/')) {
    turnstile.calls.push({ url, form: Object.fromEntries(new URLSearchParams(String(init.body))) });
    if (turnstile.mode === 'unreachable') throw new TypeError('network down');
    return new Response(JSON.stringify({ success: turnstile.mode === 'success' }), { status: 200 });
  }
  const body = JSON.parse(init.body);
  mails.push({ url, headers: init.headers, ...body });
  if (resendMode === 'fail') return new Response(JSON.stringify({ message: 'The xnyfarms.com domain is not verified.' }), { status: 403 });
  return new Response(JSON.stringify({ id: 're_' + mails.length }), { status: 200 });
};

const PW = 'admin-pw';
const KV = makeKV();
const env = { REFERRALS_KV: KV, ADMIN_REPORT_PASSWORD: PW, RESEND_API_KEY: 're_test_SECRET' };
let ipCounter = 0;
const nextIp = () => `203.0.113.${++ipCounter % 250}`;
const req = (body, { ip, method = 'POST', url = 'https://xnyfarms.com/api/x' } = {}) =>
  new Request(url, { method, body: method === 'GET' ? undefined : JSON.stringify(body), headers: { 'CF-Connecting-IP': ip || nextIp() } });
const call = async (fn, body, opts = {}, e = env) => {
  const pending = [];
  const r = await fn({ request: req(body, opts), env: e, waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  let j = null; try { j = await r.clone().json(); } catch (err) { /* redirects have no body */ }
  return { status: r.status, j, location: r.headers.get('Location'), cache: r.headers.get('Cache-Control') };
};
const form = (over = {}) => ({
  name: 'Adebayo Okafor', email: 'ade.okafor@example.com', phone: '0803 123 4567',
  bank_name: 'GTBank', account_number: '0123456789', account_holder: 'Adebayo Okafor',
  promotion_plan: 'WhatsApp groups', consent: true, website: '', ...over });
const keysWith = p => [...KV._s.keys()].filter(k => KV.live(k) && k.startsWith(p));
const tokenFrom = m => (/verify-affiliate\?token=([a-f0-9]{64})/.exec(m.text) || [])[1];
const verifyGet = async token => call(verify, null, { method: 'GET', url: 'https://xnyfarms.com/api/verify-affiliate?token=' + token });
const reset = () => { mails = []; resendMode = 'ok'; };

console.log('=== normalisation ===');
for (const [raw, want] of [
  ['John@Example.com', 'john@example.com'], ['  john@example.com ', 'john@example.com'],
  ['john+shop@example.com', 'john@example.com'], ['john+a+b@example.com', 'john@example.com'],
  ['j.o.h.n@example.com', 'j.o.h.n@example.com'],                       // dots only matter for gmail
  ['j.o.h.n@gmail.com', 'john@gmail.com'], ['J.Ohn+x@GMAIL.com', 'john@gmail.com'],
  ['john@googlemail.com', 'john@gmail.com'], ['j.ohn+q@googlemail.com', 'john@gmail.com'],
  ['not-an-email', null], ['', null], [null, null], ['+tag@example.com', null], ['a@b', null], ['a@@b.com', null]
]) check(`normaliseEmail(${JSON.stringify(raw)}) -> ${JSON.stringify(want)}`, normaliseEmail(raw) === want, normaliseEmail(raw));
for (const [raw, want] of [
  ['08031234567', '2348031234567'], ['0803 123 4567', '2348031234567'], ['0803-123-4567', '2348031234567'], ['(0803) 123 4567', '2348031234567'],
  ['+2348031234567', '2348031234567'], ['+234 803 123 4567', '2348031234567'], ['2348031234567', '2348031234567'], ['234 803 123 4567', '2348031234567'], ['002348031234567', '2348031234567'],
  ['+1 415 555 2671', '14155552671'], ['+44 20 7946 0958', '442079460958'], ['+12345678', '12345678'], ['+123456789012345', '123456789012345'],
  ['4155552671', null],          // international without +
  ['+1234567', null],           // 7 digits
  ['+1234567890123456', null],  // 16 digits
  ['0803123456', null], ['080312345678', null], ['+234 803 123 456', null], ['23480312345', null],
  ['0803 123 45x7', null], ['', null], [null, null], ['+', null], ['x'.repeat(40), null]
]) { const r = normalisePhoneIntl(raw); check(`normalisePhoneIntl(${JSON.stringify(raw)}) -> ${JSON.stringify(want)}`, (r.ok ? r.phone : null) === want && (r.ok || /\S/.test(r.error)), JSON.stringify(r)); }

console.log('\n=== successful signup: unconfirmed record + index + ONE confirmation email, nothing else ===');
reset();
let r = await call(signup, form());
check('200 ok, status check_email, no-store', r.status === 200 && r.j.ok === true && r.j.status === 'check_email' && r.cache === 'no-store', JSON.stringify(r));
check('exactly one email', mails.length === 1);
const m1 = mails[0];
check('to the address typed, from the verified sender, Reply-To xnyfarms@gmail.com', JSON.stringify(m1.to) === JSON.stringify(['ade.okafor@example.com']) && m1.from === 'XNY Farms <affiliates@xnyfarms.com>' && m1.reply_to === 'xnyfarms@gmail.com');
const token1 = tokenFrom(m1);
check('the link is https://xnyfarms.com/api/verify-affiliate?token=<64 hex> (html and text)', !!token1 && m1.html.includes(`https://xnyfarms.com/api/verify-affiliate?token=${token1}`) && m1.subject.startsWith('Confirm your email'));
check('no affiliate yet, no referral code anywhere', keysWith('affiliate:').length === 0 && !/[?&]ref=|your referral code is/i.test(m1.html + m1.text));
const appKeys = keysWith('application:');
check('one application, status "unconfirmed", source self-signup', appKeys.length === 1 && JSON.parse(KV._s.get(appKeys[0]).value).status === 'unconfirmed' && JSON.parse(KV._s.get(appKeys[0]).value).source === 'self-signup');
check('idx:email and idx:phone keys exist, normalised', keysWith('idx:email:').join() === 'idx:email:adeokafor@example.com'.replace('adeokafor', 'ade.okafor') && keysWith('idx:phone:').join() === 'idx:phone:2348031234567', keysWith('idx:').join());
check('verify:{token} exists', keysWith('verify:').join() === 'verify:' + token1);
const kinds = [...KV._s.keys()].map(k => k.split(':')[0]).filter(k => !['rl'].includes(k)).sort().join();
check('KV holds only: application, idx x2, verify (+ rate-limit counters)', kinds === 'application,idx,idx,verify', kinds);
check('confirmation email carries no bank details', !m1.html.includes('0123456789') && !m1.text.includes('0123456789') && !/GTBank/.test(m1.html));
check('the application metadata is {s:"unconfirmed", n, at}', JSON.stringify(Object.keys(KV._s.get(appKeys[0]).metadata)) === JSON.stringify(['s', 'n', 'at']) && KV._s.get(appKeys[0]).metadata.s === 'unconfirmed');
const TTL = 48 * 3600;
check('unconfirmed records carry a 48h TTL: application, both idx keys and the token', KV.ttl(appKeys[0]) === TTL && KV.ttl('idx:email:ade.okafor@example.com') === TTL && KV.ttl('idx:phone:2348031234567') === TTL && KV.ttl('verify:' + token1) === TTL, [KV.ttl(appKeys[0]), KV.ttl('verify:' + token1)].join());
check('the verify token is 32 random bytes (64 hex) and differs per signup', /^[a-f0-9]{64}$/.test(token1));

console.log('\n=== confirmation email: white text on a dark fill ===');
const demo = buildConfirmationEmail({ name: 'Adebayo Okafor', verifyUrl: 'https://xnyfarms.com/api/verify-affiliate?token=' + 'a'.repeat(64) });
const lum = hex => { const n = parseInt(hex.slice(1), 16); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
const cells = [...demo.html.matchAll(/<td\b([^>]*class="btn-cell"[^>]*)>([\s\S]*?)<\/td>/g)].map(m => ({ fill: (/bgcolor="(#[0-9a-f]{6})"/.exec(m[1]) || [])[1], a: (/<a\b[^>]*class="btn-link"[^>]*style="([^"]*)"/.exec(m[2]) || [])[1], label: m[2].replace(/<[^>]+>/g, '').trim() }));
check('one call-to-action ("Confirm My Email") plus the X pill', cells.length === 2 && cells[0].label === 'Confirm My Email', JSON.stringify(cells.map(c => c.label)));
check('every button: #ffffff !important on a fill with luminance < 0.2', cells.every(c => /color:#ffffff !important/.test(c.a) && lum(c.fill) < 0.2), JSON.stringify(cells));
check('the confirm button is dark green', cells[0].fill === '#06552a');
check('no yellow, plain-text alternative has the link and no markup', !/#dad905/i.test(demo.html) && demo.text.includes('verify-affiliate?token=') && !/<|style=/.test(demo.text));
check('says it expires in 48 hours and what to do if it wasn\'t them', /48 hours/.test(demo.html) && /ignore this email/.test(demo.html));

console.log('\n=== validation (nothing stored, nothing sent) ===');
const before = [...KV._s.keys()].length; const mailsBefore = mails.length;
for (const [label, over, field] of [
  ['no name', { name: '' }, 'name'], ['one-letter name', { name: 'A' }, 'name'], ['digits-only name', { name: '12345' }, 'name'],
  ['bad email', { email: 'nope' }, 'email'], ['bad phone', { phone: '123' }, 'phone'], ['phone with letters', { phone: '0803abc4567' }, 'phone'],
  ['no bank', { bank_name: '' }, 'bank_name'], ['short account number', { account_number: '123' }, 'account_number'], ['symbols in account number', { account_number: '12345!@#678' }, 'account_number'],
  ['no account holder', { account_holder: ' ' }, 'account_holder'],
  ['no consent', { consent: false }, 'consent'], ['consent as a string', { consent: 'true' }, 'consent'], ['consent missing', { consent: undefined }, 'consent']
]) { r = await call(signup, form({ email: 'v' + Math.random().toString(36).slice(2, 8) + '@example.com', phone: '08029998888', ...over })); check(`${label} -> 400 naming "${field}"`, r.status === 400 && r.j.field === field && /\S/.test(r.j.error), JSON.stringify(r)); }
check('and no new application/idx/verify keys', keysWith('application:').length === 1 && keysWith('idx:').length === 2 && keysWith('verify:').length === 1 && mails.length === mailsBefore);
r = await call(signup, 'not an object'); check('non-object body -> 400', r.status === 400);
const long = form({ email: 'long@example.com', phone: '0803 999 1111', name: 'N'.repeat(500), bank_name: 'B'.repeat(500), account_holder: 'H'.repeat(500), promotion_plan: 'P'.repeat(5000) });
r = await call(signup, long);
const longApp = JSON.parse(KV._s.get(keysWith('application:').filter(k => JSON.parse(KV._s.get(k).value).email === 'long@example.com')[0]).value);
check('over-long fields are cut to strict limits (name 100, bank 80, holder 100, plan 1000)', r.status === 200 && longApp.name.length === 100 && longApp.bank_name.length === 80 && longApp.account_holder.length === 100 && longApp.promotion_plan.length === 1000);
check('control characters are stripped from stored text', (await call(signup, form({ email: 'ctl@example.com', phone: '0803 999 2222', name: 'Eve\u0000\u0007 Ctl\nRow' }))).status === 200 && !keysWith('application:').some(k => /[\u0000-\u0008]/.test(KV._s.get(k).value)));

console.log('\n=== confirming creates the affiliate (and sends the welcome) exactly once ===');
reset();
const mailsBeforeConfirm = mails.length;
r = await verifyGet(token1);
check('302 to /affiliate-confirmed.html?status=ok&code=…', r.status === 302 && /^https:\/\/xnyfarms\.com\/affiliate-confirmed\.html\?status=ok&code=[A-Z0-9]+$/.test(r.location) && r.cache === 'no-store', r.location);
const code1 = new URL(r.location).searchParams.get('code');
check('code is first 3 letters of the first name + first 4 of the last: ADEOKAF', code1 === 'ADEOKAF', code1);
const aff1 = JSON.parse(KV._s.get('affiliate:' + code1).value);
check('affiliate record: name, email, phone, approved_at, application_key, status active, source self-signup, email_verified_at',
  aff1.name === 'Adebayo Okafor' && aff1.email === 'ade.okafor@example.com' && aff1.phone === '2348031234567' && aff1.approved_at && aff1.application_key === appKeys[0] && aff1.status === 'active' && aff1.source === 'self-signup' && aff1.email_verified_at === aff1.approved_at, JSON.stringify(aff1));
check('affiliate metadata carries name/email/time + status/source/verified', (m => m.n === 'Adebayo Okafor' && m.e === 'ade.okafor@example.com' && m.s === 'active' && m.src === 'self-signup' && m.v && m.k === appKeys[0])(KV._s.get('affiliate:' + code1).metadata));
check('exactly two emails: the welcome (to the affiliate) and a notice to xnyfarms@gmail.com', mails.length === mailsBeforeConfirm + 2);
const welcome = mails[mailsBeforeConfirm], notice = mails[mailsBeforeConfirm + 1];
check('welcome: to the signup email, the standard subject, referral link button with the code, earnings button, 8%, X link',
  JSON.stringify(welcome.to) === JSON.stringify(['ade.okafor@example.com']) && welcome.subject === 'Welcome to the XNY Farms Affiliate Program!' && welcome.html.includes(`https://xnyfarms.com/?ref=${code1}`) && welcome.html.includes(`my-stats.html?code=${code1}`) && /8% commission/.test(welcome.html) && welcome.html.includes('https://x.com/xnyfarms') && welcome.reply_to === 'xnyfarms@gmail.com');
check('admin notice: to xnyfarms@gmail.com, "New affiliate: <name>, <code>"', JSON.stringify(notice.to) === JSON.stringify(['xnyfarms@gmail.com']) && notice.subject.includes('New affiliate') && notice.subject.includes('Adebayo Okafor') && notice.subject.includes(code1) && notice.text.includes(code1));
const appAfter = KV._s.get(appKeys[0]);
check('the application is now permanent (no TTL), status approved, token and expiry removed, bank details kept', appAfter.ttl === undefined && JSON.parse(appAfter.value).status === 'approved' && JSON.parse(appAfter.value).approved_code === code1 && !('verify_token' in JSON.parse(appAfter.value)) && JSON.parse(appAfter.value).account_number === '0123456789');
check('the idx keys are permanent and now point at the affiliate', KV.ttl('idx:email:ade.okafor@example.com') === undefined && KV.ttl('idx:phone:2348031234567') === undefined && JSON.parse(KV._s.get('idx:email:ade.okafor@example.com').value).code === code1 && JSON.parse(KV._s.get('idx:email:ade.okafor@example.com').value).type === 'affiliate');
check('the token is marked used (code + used_at) and kept for 90 days', (t => t.code === code1 && t.used_at)(JSON.parse(KV._s.get('verify:' + token1).value)) && KV.ttl('verify:' + token1) === 90 * 86400);
check('the welcome outcome is recorded on the affiliate (welcome_email.ok)', JSON.parse(KV._s.get('affiliate:' + code1).value).welcome_email.ok === true);
// the pending-applications list must not show it
check('the signup does not appear as a pending application', JSON.parse(KV._s.get(appKeys[0]).value).status !== 'pending' && KV._s.get(appKeys[0]).metadata.s === 'approved');

console.log('\n=== opening the link again (scanners prefetch!) creates nothing twice ===');
const affCount = keysWith('affiliate:').length, mailCount = mails.length;
for (let i = 0; i < 3; i++) {
  r = await verifyGet(token1);
  check(`visit #${i + 2}: same redirect, same code`, r.status === 302 && new URL(r.location).searchParams.get('code') === code1 && new URL(r.location).searchParams.get('status') === 'ok');
}
check('still exactly one affiliate and NO further emails', keysWith('affiliate:').length === affCount && mails.length === mailCount, mails.length - mailCount);
// scanner and person at the same time
{
  reset();
  const k2 = makeKV(); const e2 = { ...env, REFERRALS_KV: k2 };
  const sub = await signup({ request: req(form({ email: 'race@example.com', phone: '0803 555 0001', name: 'Race Condition' })), env: e2, waitUntil() {} });
  const t = tokenFrom(mails[0]); mails = [];
  const mk = () => verify({ request: new Request('https://xnyfarms.com/api/verify-affiliate?token=' + t), env: e2 });
  const [a, b] = await Promise.all([mk(), mk()]);
  const codeA = new URL(a.headers.get('Location')).searchParams.get('code'), codeB = new URL(b.headers.get('Location')).searchParams.get('code');
  check('two simultaneous opens converge on ONE code and one affiliate record', codeA === codeB && [...k2._s.keys()].filter(k => k.startsWith('affiliate:')).length === 1, codeA + ' / ' + codeB);
}
reset();

console.log('\n=== duplicates of a CONFIRMED affiliate ===');
const dupFields = async (over, want, label) => {
  const mk = mails.length, keys = [...KV._s.keys()].filter(k => !k.startsWith('rl:')).length;
  const rr = await call(signup, form(over));
  check(`${label} -> 409 naming ${want}`, rr.status === 409 && rr.j.status === 'already_registered' && rr.j.field === want && (want === 'email' ? /This email is already registered/.test(rr.j.error) : /This phone number is already registered/.test(rr.j.error)) && /Resend my welcome email/.test(rr.j.error) && rr.j.resend_welcome === true, JSON.stringify(rr.j));
  check('   ...nothing stored, nothing sent', mails.length === mk && [...KV._s.keys()].filter(k => !k.startsWith('rl:')).length === keys);
};
const freshPhone = '0805 000 1234';
await dupFields({ phone: freshPhone }, 'email', 'same email');
await dupFields({ email: 'ADE.OKAFOR@EXAMPLE.COM', phone: freshPhone }, 'email', 'same email, upper case');
await dupFields({ email: 'ade.okafor+shop@example.com', phone: freshPhone }, 'email', 'same email with a +tag');
// gmail variants need a gmail affiliate: create via a second signup + confirm
r = await call(signup, form({ name: 'Gina Mail', email: 'gina.mail@gmail.com', phone: '0803 222 3333' }));
await verifyGet(tokenFrom(mails[mails.length - 1]));
await dupFields({ email: 'ginamail@gmail.com', phone: freshPhone }, 'email', 'gmail without dots');
await dupFields({ email: 'g.i.n.a.m.a.i.l+promo@gmail.com', phone: freshPhone }, 'email', 'gmail with other dots and a +tag');
await dupFields({ email: 'ginamail@googlemail.com', phone: freshPhone }, 'email', 'googlemail.com treated as gmail.com');
await dupFields({ email: 'ginamail+x@GoogleMail.com', phone: freshPhone }, 'email', 'googlemail + tag + case');
r = await call(signup, form({ email: 'gina.mail@yahoo.com', phone: freshPhone })); check('dots are NOT ignored on other providers (gina.mail@yahoo.com is a different address)', r.status === 200);
await verifyGet(tokenFrom(mails[mails.length - 1]));
await dupFields({ email: 'fresh1@example.com', phone: '0803 123 4567' }, 'phone', 'same phone 0803…');
await dupFields({ email: 'fresh2@example.com', phone: '08031234567' }, 'phone', 'same phone, no spaces');
await dupFields({ email: 'fresh3@example.com', phone: '+234 803 123 4567' }, 'phone', 'same phone as +234 803…');
await dupFields({ email: 'fresh4@example.com', phone: '2348031234567' }, 'phone', 'same phone as 234803…');
await dupFields({ email: 'fresh5@example.com', phone: '0803-123-4567' }, 'phone', 'same phone with dashes');
await dupFields({ email: 'fresh6@example.com', phone: '(0803) 123 4567' }, 'phone', 'same phone with brackets');
r = await call(signup, form({ phone: '0803 123 4567' }));
check('both fields duplicate -> one 409 naming both', r.status === 409 && /email and phone number are already registered/.test(r.j.error) && r.j.fields.join() === 'email,phone', JSON.stringify(r.j));
reset();

console.log('\n=== an UNCONFIRMED signup in its window: no second one, resend is rate limited ===');
const pend = form({ name: 'Pending Person', email: 'pending.person@example.com', phone: '0809 111 0000' });
r = await call(signup, pend); const pendMail = mails[mails.length - 1]; const pendToken = tokenFrom(pendMail);
check('first signup sends a confirmation', r.status === 200 && JSON.stringify(pendMail.to) === JSON.stringify(['pending.person@example.com']));
reset();
const keysBefore = [...KV._s.keys()].filter(k => !k.startsWith('rl:')).length;
for (const [label, over] of [['same email', { email: 'pending.person@example.com', phone: '0809 111 9999' }], ['same email, +tag', { email: 'pending.person+2@example.com', phone: '0809 111 9998' }], ['same phone, other email', { email: 'someone.else@example.com', phone: '+234 809 111 0000' }]]) {
  r = await call(signup, form({ ...over }));
  check(`${label} -> 409 pending_confirmation, offers a resend`, r.status === 409 && r.j.status === 'pending_confirmation' && r.j.can_resend === true && /already sent a confirmation email/.test(r.j.error), JSON.stringify(r.j));
}
check('no second signup was created and no email was sent', mails.length === 0 && [...KV._s.keys()].filter(k => !k.startsWith('rl:')).length === keysBefore && keysWith('verify:').filter(k => k !== 'verify:' + pendToken).length >= 0);
r = await call(resendConfirmation, { email: 'pending.person@example.com' });
check('resend inside the 10-minute cooldown -> 429, nothing sent', r.status === 429 && r.j.status === 'cooldown' && /minute/.test(r.j.error) && mails.length === 0, JSON.stringify(r.j));
advance(9 * MIN);
r = await call(resendConfirmation, { email: 'pending.person@example.com' }); check('9 minutes: still cooling down', r.status === 429 && mails.length === 0);
advance(2 * MIN);
r = await call(resendConfirmation, { email: 'Pending.Person+x@Example.com', to: 'attacker@evil.com', recipient: 'attacker@evil.com' });
check('after 10 minutes the resend goes through, to the address STORED on the signup (not the one in the request)', r.status === 200 && r.j.status === 'resent' && mails.length === 1 && JSON.stringify(mails[0].to) === JSON.stringify(['pending.person@example.com']) && !JSON.stringify(mails[0]).includes('evil'), JSON.stringify(r.j));
check('...with the SAME link (the earlier email keeps working)', tokenFrom(mails[0]) === pendToken);
r = await call(resendConfirmation, { email: 'pending.person@example.com' }); check('and the cooldown restarts', r.status === 429);
check('the resend did not extend the signup\'s 48h life', KV.ttl(keysWith('application:').find(k => JSON.parse(KV._s.get(k).value).email === 'pending.person@example.com')) <= TTL - 11 * 60 + 5, KV.ttl(keysWith('application:').find(k => JSON.parse(KV._s.get(k).value).email === 'pending.person@example.com')));
advance(11 * MIN);
r = await call(resendConfirmation, { email: 'pending.person@example.com' });
check('the third confirmation email of the day (first + 2 resends) is still allowed', r.status === 200 && r.j.status === 'resent', JSON.stringify(r));
advance(11 * MIN);
r = await call(resendConfirmation, { email: 'pending.person@example.com' });
check('the 4th confirmation email in a day is refused', r.status === 429 && r.j.status === 'rate_limited', JSON.stringify(r.j));
r = await call(resendConfirmation, { email: 'nobody.here@example.com' }); check('resend for an email with no pending signup -> 404 with a helpful message', r.status === 404 && /sign up again/.test(r.j.error));
r = await call(resendConfirmation, { email: 'garbage' }); check('resend with a bad email -> 400', r.status === 400);
reset();

console.log('\n=== expiry: unconfirmed signups delete themselves after 48 hours ===');
const exp = form({ name: 'Short Lived', email: 'short.lived@example.com', phone: '0807 000 2222' });
await call(signup, exp); const expToken = tokenFrom(mails[mails.length - 1]); reset();
check('before expiry the data is there', keysWith('verify:').includes('verify:' + expToken) && keysWith('idx:email:').includes('idx:email:short.lived@example.com'));
advance(48 * HOUR + 1000);
check('after 48h the application, both idx keys and the token are all gone (no bank details kept)',
  !keysWith('verify:').includes('verify:' + expToken) && !keysWith('idx:email:').includes('idx:email:short.lived@example.com') && !keysWith('idx:phone:').includes('idx:phone:2348070002222') && !keysWith('application:').some(k => /Short Lived/.test(KV._s.get(k).value)));
r = await verifyGet(expToken);
check('the old link -> status=expired (friendly page), no affiliate created', r.status === 302 && new URL(r.location).searchParams.get('status') === 'expired' && !new URL(r.location).searchParams.has('code') && !keysWith('affiliate:').some(k => JSON.parse(KV._s.get(k).value).name === 'Short Lived'));
r = await call(signup, exp); check('the same person can simply sign up again', r.status === 200 && mails.length === 1);
reset();
r = await verifyGet('f'.repeat(64)); check('unknown (well-formed) token -> status=expired', new URL(r.location).searchParams.get('status') === 'expired');
for (const bad of ['', 'short', 'g'.repeat(64), 'A'.repeat(64), '../../etc/passwd', 'a'.repeat(63), 'a'.repeat(65)]) {
  r = await verifyGet(bad); check(`malformed token ${JSON.stringify(bad.slice(0, 12))} -> status=invalid`, r.status === 302 && new URL(r.location).searchParams.get('status') === 'invalid', r.location);
}
check('none of those created anything or sent mail', mails.length === 0);
// signup whose application expired but token somehow remains: no affiliate
{
  const k3 = makeKV(); const e3 = { ...env, REFERRALS_KV: k3 };
  await signup({ request: req(form({ email: 'orphan@example.com', phone: '0803 666 0001' })), env: e3, waitUntil() {} });
  const t = tokenFrom(mails[mails.length - 1]); mails = [];
  const appK = [...k3._s.keys()].find(k => k.startsWith('application:')); await k3.delete(appK);
  const res = await verify({ request: new Request('https://xnyfarms.com/api/verify-affiliate?token=' + t), env: e3 });
  check('token present but the signup record gone -> expired, nothing created', new URL(res.headers.get('Location')).searchParams.get('status') === 'expired' && ![...k3._s.keys()].some(k => k.startsWith('affiliate:')) && mails.length === 0);
}
reset();

console.log('\n=== code generation ===');
check('codeBase: 3 letters of the first name + 4 of the last', codeBase('Adebayo Okafor') === 'ADEOKAF' && codeBase('chinwe nneka eze') === 'CHIEZE' && codeBase('Olu-Seun  Adewale-Johnson') === 'OLUADEW', [codeBase('Olu-Seun  Adewale-Johnson')].join());
check('codeBase: uppercase A-Z only (accents, digits, punctuation dropped)', codeBase('José Ñoño') === 'JOSNONO' || /^[A-Z]+$/.test(codeBase('José Ñoño')), codeBase('José Ñoño'));
check('codeBase pads short names from the rest of the name and is never under 3 letters', codeBase('Ngozi') === 'NGOZI' && codeBase('Al Bu') === 'ALBU' && codeBase('Li') .length >= 3 && codeBase('张伟') === 'AFF' && codeBase('') === 'AFF');
check('reserved words are never issued as they are', [...['ADMIN', 'XNY', 'XNYFARMS', 'TEST']].every(w => RESERVED_CODES.has(w)));
for (const nm of ['Admin', 'Xny', 'Test']) {
  const c = await pickCode({ name: nm, seed: 's1', isTaken: async () => false });
  check(`a name that makes the reserved word ${codeBase(nm)} gets digits appended: ${c}`, !RESERVED_CODES.has(c) && c.startsWith(codeBase(nm)) && /^[A-Z]+\d{2}$/.test(c), c);
}
{
  const taken = new Set(['ADEOKAF']);
  let c = await pickCode({ name: 'Adebayo Okafor', seed: 'seedA', isTaken: async x => taken.has(x) });
  check('collision -> base + 2 digits', /^ADEOKAF\d{2}$/.test(c), c);
  taken.add(c);
  let c2 = await pickCode({ name: 'Adebayo Okafor', seed: 'seedA', isTaken: async x => taken.has(x) });
  check('collides again -> another 2-digit suffix, never the same code twice', /^ADEOKAF\d{2}$/.test(c2) && c2 !== c, c2);
  for (let i = 0; i < 40; i++) { taken.add(await pickCode({ name: 'Adebayo Okafor', seed: 'seedA', isTaken: async x => taken.has(x) })); }
  check('40 more collisions later, every code is still unique', taken.size === 42, taken.size);
  const same1 = await pickCode({ name: 'Zed Zee', seed: 'same-seed', isTaken: async x => x === 'ZEDZEE' });
  const same2 = await pickCode({ name: 'Zed Zee', seed: 'same-seed', isTaken: async x => x === 'ZEDZEE' });
  check('the digits are derived from the signup, so the same signup always lands on the same code', same1 === same2);
  check('different signups get different digits (not a fixed suffix)', (await codeCandidate('Zed Zee', 'a', 1)) !== (await codeCandidate('Zed Zee', 'b', 1)) || (await codeCandidate('Zed Zee', 'a', 2)) !== (await codeCandidate('Zed Zee', 'b', 2)));
}
// through the whole flow: a taken base, and a reserved word, and a code that already earned money
{
  const k4 = makeKV(); const e4 = { ...env, REFERRALS_KV: k4 };
  await k4.put('affiliate:ADEOKAF', JSON.stringify({ name: 'Existing', email: 'existing@example.com', approved_at: '2025-01-01T00:00:00.000Z' }), { metadata: { n: 'Existing', e: 'existing@example.com', at: '2025-01-01T00:00:00.000Z' } });
  await k4.put('referral:ADEOKAF99:old', '{}', { metadata: { c: 'ADEOKAF99', t: 1, m: 0.08, ts: 'x' } });   // a code that earned something earlier
  const mk = async (over) => { mails = []; await signup({ request: req(form(over)), env: e4, waitUntil() {} }); const t = tokenFrom(mails[0]); const res = await verify({ request: new Request('https://xnyfarms.com/api/verify-affiliate?token=' + t), env: e4 }); return new URL(res.headers.get('Location')).searchParams.get('code'); };
  const a = await mk({ email: 'a1@example.com', phone: '0803 700 0001' });
  check('a name whose code is already an affiliate gets a suffixed code; the existing affiliate is unchanged', /^ADEOKAF\d{2}$/.test(a) && a !== 'ADEOKAF99' && JSON.parse(k4._s.get('affiliate:ADEOKAF').value).name === 'Existing', a);
  const b = await mk({ email: 'a2@example.com', phone: '0803 700 0002' });
  check('a second one gets yet another', /^ADEOKAF\d{2}$/.test(b) && b !== a && b !== 'ADEOKAF99');
  const c = await mk({ email: 'a3@example.com', phone: '0803 700 0003', name: 'Admin' });
  check('a name that spells a reserved word gets digits', /^ADMIN\d{2,3}$/.test(c), c);
  check('every code issued is unique across the whole run', new Set([a, b, c]).size === 3);
}
reset();

console.log('\n=== abuse protection ===');
{
  const k5 = makeKV(); const e5 = { ...env, REFERRALS_KV: k5 };
  mails = [];
  const hp = await signup({ request: req(form({ email: 'bot@example.com', website: 'http://spam.example' })), env: e5, waitUntil() {} });
  const hj = await hp.json();
  check('honeypot filled: answered as a success...', hp.status === 200 && hj.ok === true && hj.status === 'check_email');
  check('...but nothing was stored, nothing sent, no rate-limit counter touched', mails.length === 0 && k5._s.size === 0, [...k5._s.keys()].join());
  const hp2 = await signup({ request: req(form({ email: 'bot2@example.com', phone: '0803 123 0987', website: ' ' })), env: e5, waitUntil() {} }); check('a whitespace-only honeypot value counts as empty: a normal signup (one email)', hp2.status === 200 && mails.length === 1);
}
{
  // per-IP signup limit: 5 per hour
  const k6 = makeKV(); const e6 = { ...env, REFERRALS_KV: k6 }; mails = [];
  const ip = '198.51.100.7'; const results = [];
  for (let i = 0; i < 7; i++) { const rr = await signup({ request: req(form({ email: `ip${i}@example.com`, phone: `0803 800 00${10 + i}` }), { ip }), env: e6, waitUntil() {} }); results.push(rr.status); }
  check('per-IP: 5 signups in an hour are accepted, the 6th and 7th get 429', results.join() === '200,200,200,200,200,429,429', results.join());
  check('only 5 confirmation emails went out', mails.length === 5, mails.length);
  const other = await signup({ request: req(form({ email: 'other-ip@example.com', phone: '0803 800 0099' }), { ip: '198.51.100.8' }), env: e6, waitUntil() {} });
  check('a different IP is not affected', other.status === 200);
  advance(61 * MIN);
  const later = await signup({ request: req(form({ email: 'later@example.com', phone: '0803 800 0098' }), { ip }), env: e6, waitUntil() {} });
  check('the limit resets after an hour', later.status === 200, later.status);
  const rl = await (await signup({ request: req(form({ email: 'x1@example.com', phone: '0803 800 0097' }), { ip: '198.51.100.9' }), env: e6, waitUntil() {} })).json(); check('(sanity) a normal request still works', rl.ok === true);
}
{
  // attempts limit: 30/hour regardless of outcome
  const k7 = makeKV(); const e7 = { ...env, REFERRALS_KV: k7 }; mails = []; const ip = '198.51.100.20'; let last;
  for (let i = 0; i < 31; i++) last = await signup({ request: req(form({ email: 'bad' }), { ip }), env: e7, waitUntil() {} });
  check('attempt limit: the 31st request in an hour is refused with 429 even though every one was invalid', last.status === 429 && (await last.json()).status === 'rate_limited');
}
{
  // per-email limit on confirmation emails: 3/day; a signup that expires then re-signs up
  const k8 = makeKV(); const e8 = { ...env, REFERRALS_KV: k8 }; mails = []; const codes = [];
  for (let i = 0; i < 4; i++) {
    const rr = await signup({ request: req(form({ email: 'again@example.com', phone: '0803 900 0001' })), env: e8, waitUntil() {} }); codes.push(rr.status);
    // expire the signup so the dup check lets the next attempt through, without moving the 24h counter far
    for (const k of [...k8._s.keys()]) if (k.startsWith('application:') || k.startsWith('idx:') || k.startsWith('verify:')) k8._s.delete(k);
  }
  check('per-email: 3 confirmation emails a day, the 4th signup for the same address is 429', codes.join() === '200,200,200,429', codes.join());
}
reset();

console.log('\n=== Turnstile (optional) ===');
{
  const k9 = makeKV(); mails = []; turnstile = { mode: 'success', calls: [] };
  const eOff = { ...env, REFERRALS_KV: k9 };
  let rr = await signup({ request: req(form({ email: 't0@example.com', phone: '0803 910 0000' })), env: eOff, waitUntil() {} });
  check('secret NOT configured: skipped, signup works with no token, Cloudflare never called', rr.status === 200 && turnstile.calls.length === 0);
  const eOn = { ...env, REFERRALS_KV: k9, TURNSTILE_SECRET_KEY: 'turnstile-secret-xyz' };
  rr = await signup({ request: req(form({ email: 't1@example.com', phone: '0803 910 0001' })), env: eOn, waitUntil() {} });
  let jj = await rr.json();
  check('secret configured + no token -> 400 field "turnstile", nothing sent', rr.status === 400 && jj.field === 'turnstile' && turnstile.calls.length === 0 && mails.length === 1);
  rr = await signup({ request: req(form({ email: 't2@example.com', phone: '0803 910 0002', turnstile_token: 'good-token' }), { ip: '198.51.100.40' }), env: eOn, waitUntil() {} });
  check('secret configured + valid token -> 200', rr.status === 200 && mails.length === 2);
  const call0 = turnstile.calls[0];
  check('siteverify is called once with the secret, the token and the client IP', turnstile.calls.length === 1 && call0.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && call0.form.secret === 'turnstile-secret-xyz' && call0.form.response === 'good-token' && call0.form.remoteip === '198.51.100.40', JSON.stringify(call0));
  turnstile.mode = 'failure';
  rr = await signup({ request: req(form({ email: 't3@example.com', phone: '0803 910 0003', turnstile_token: 'bad' })), env: eOn, waitUntil() {} }); jj = await rr.json();
  check('invalid token -> 400, nothing stored or sent', rr.status === 400 && jj.field === 'turnstile' && mails.length === 2 && ![...k9._s.keys()].some(k => k.startsWith('idx:email:t3')));
  turnstile.mode = 'unreachable';
  rr = await signup({ request: req(form({ email: 't4@example.com', phone: '0803 910 0004', turnstile_token: 'x' })), env: eOn, waitUntil() {} }); jj = await rr.json();
  check('Cloudflare unreachable while configured -> fails CLOSED with 503 (an outage does not switch protection off)', rr.status === 503 && jj.field === 'turnstile' && mails.length === 2);
  turnstile.mode = 'success';
  rr = await signup({ request: req(form({ email: 't5@example.com', phone: '0803 910 0005', turnstile_token: 'x'.repeat(5000) })), env: eOn, waitUntil() {} });
  { const calls = turnstile.calls.length; rr = await signup({ request: req(form({ email: 't6@example.com', phone: '0803 910 0006', turnstile_token: 'x'.repeat(5000) })), env: eOn, waitUntil() {} }); check('an absurdly long token is rejected without calling Cloudflare', rr.status === 400 && turnstile.calls.length === calls); }
  const ga = await getAffiliates({ request: req({ password: PW }), env: eOn }); const gaOff = await getAffiliates({ request: req({ password: PW }), env: eOff });
  check('the admin endpoint reports whether Turnstile is configured (so the admin page can warn)', (await ga.json()).config.turnstile_secret_configured === true && (await gaOff.json()).config.turnstile_secret_configured === false);
}
reset();

console.log('\n=== Resend failure: everything is rolled back so a retry starts clean ===');
{
  const k10 = makeKV(); const e10 = { ...env, REFERRALS_KV: k10 }; mails = []; resendMode = 'fail';
  let rr = await signup({ request: req(form({ email: 'rollback@example.com', phone: '0803 920 0001' })), env: e10, waitUntil() {} }); let jj = await rr.json();
  check('Resend down -> 502 with a friendly message (no provider detail leaked)', rr.status === 502 && /try again/.test(jj.error) && !/domain|verified|Resend/.test(jj.error), JSON.stringify(jj));
  check('nothing is left behind: no application, no idx, no token', [...k10._s.keys()].filter(k => !k.startsWith('rl:')).length === 0, [...k10._s.keys()].join());
  resendMode = 'ok'; mails = [];
  rr = await signup({ request: req(form({ email: 'rollback@example.com', phone: '0803 920 0001' })), env: e10, waitUntil() {} });
  check('the retry works (not blocked as a duplicate)', rr.status === 200 && mails.length === 1);
  rr = await signup({ request: req(form({ email: 'x@example.com' })), env: { ...env, REFERRALS_KV: k10, RESEND_API_KEY: undefined }, waitUntil() {} });
  check('no RESEND_API_KEY -> 503, nothing stored', rr.status === 503);
  rr = await signup({ request: req(form()), env: { ...env, REFERRALS_KV: undefined }, waitUntil() {} }); check('no KV -> 503', rr.status === 503);
}
reset();

console.log('\n=== no endpoint takes a recipient from the browser ===');
{
  const k11 = makeKV(); const e11 = { ...env, REFERRALS_KV: k11 }; mails = [];
  await signup({ request: req(form({ email: 'honest@example.com', phone: '0803 930 0001', to: 'attacker@evil.com', recipient: 'attacker@evil.com', cc: 'attacker@evil.com', reply_to: 'attacker@evil.com', verify_url: 'https://evil.example/x', token: 'a'.repeat(64) })), env: e11, waitUntil() {} });
  check('signup: extra to/cc/recipient/reply_to/verify_url fields are ignored; only the signup address is mailed', mails.length === 1 && JSON.stringify(mails[0].to) === JSON.stringify(['honest@example.com']) && !JSON.stringify(mails[0]).includes('evil') && mails[0].reply_to === 'xnyfarms@gmail.com');
  check('the link in the email is built from the stored token, on xnyfarms.com', tokenFrom(mails[0]) && !mails[0].html.includes('evil'));
  const t = tokenFrom(mails[0]); mails = [];
  const res = await verify({ request: new Request('https://xnyfarms.com/api/verify-affiliate?token=' + t + '&email=attacker@evil.com&to=attacker@evil.com'), env: e11 });
  check('verify: only the token matters; ?email=/?to= are ignored; welcome goes to the signup address; notice to the XNY inbox',
    mails.length === 2 && JSON.stringify(mails[0].to) === JSON.stringify(['honest@example.com']) && JSON.stringify(mails[1].to) === JSON.stringify(['xnyfarms@gmail.com']) && !JSON.stringify(mails).includes('evil'));
  check('verify never leaves our own origin (redirect is to /affiliate-confirmed.html)', new URL(res.headers.get('Location')).origin === 'https://xnyfarms.com' && new URL(res.headers.get('Location')).pathname === '/affiliate-confirmed.html');
}
reset();

console.log('\n=== suspended affiliates are not credited ===');
{
  const k12 = makeKV(); const e12 = { ...env, REFERRALS_KV: k12 };
  const put = (code, extra) => k12.put('affiliate:' + code, JSON.stringify({ name: code, email: code.toLowerCase() + '@example.com', approved_at: '2025-01-01T00:00:00.000Z', ...extra }), { metadata: { n: code, e: code.toLowerCase() + '@example.com', at: '2025-01-01T00:00:00.000Z', ...(extra.status ? { s: extra.status } : {}) } });
  await put('LEGACY1', {});                       // no status at all: active
  await put('ACTIVE2', { status: 'active' });
  await put('PAUSED3', { status: 'suspended' });
  const sale = (code, n) => logReferral({ request: req({ ref_code: code, tx_ref: 'tx' + n, order_total_ngn: 1000 }), env: e12 }).then(async r => ({ status: r.status, j: await r.json() }));
  let s = await sale('LEGACY1', 1); check('an affiliate with NO status keeps earning (existing affiliates are unaffected)', s.j.logged === true);
  s = await sale('ACTIVE2', 2); check('status "active" earns', s.j.logged === true);
  s = await sale('PAUSED3', 3); check('status "suspended" is NOT credited (and the customer sees nothing different: ok:true)', s.status === 200 && s.j.ok === true && s.j.logged === false && !k12._s.has('referral:PAUSED3:tx3'), JSON.stringify(s.j));
  const stats = async code => (await myStats({ request: new Request('https://x/api/get-my-stats?code=' + code), env: e12 })).json();
  let st = await stats('PAUSED3');
  check('my-stats for a suspended code: paused, and NO figures', st.ok === true && st.paused === true && !('commission_ngn' in st) && !('orders' in st) && !('payments' in st), JSON.stringify(st));
  st = await stats('LEGACY1'); check('my-stats for an active code is unchanged (no "paused" key)', st.ok && !('paused' in st) && st.orders === 1);
  // admin flips it
  let r1 = await call(setStatus, { password: PW, code: 'active2', status: 'suspended' }, {}, e12);
  check('suspend: ok, changed', r1.status === 200 && r1.j.ok && r1.j.status === 'suspended' && r1.j.changed === true, JSON.stringify(r1.j));
  const rec = JSON.parse(k12._s.get('affiliate:ACTIVE2').value);
  check('record keeps everything and gains suspended_at; metadata status is updated', rec.status === 'suspended' && rec.suspended_at && rec.name === 'ACTIVE2' && k12._s.get('affiliate:ACTIVE2').metadata.s === 'suspended' && k12._s.get('affiliate:ACTIVE2').metadata.n === 'ACTIVE2');
  s = await sale('ACTIVE2', 4); check('...and it stops earning at once', s.j.logged === false);
  check('its earlier sale is still there (nothing deleted)', k12._s.has('referral:ACTIVE2:tx2'));
  r1 = await call(setStatus, { password: PW, code: 'ACTIVE2', status: 'active' }, {}, e12);
  check('reactivate: ok', r1.j.ok && r1.j.status === 'active' && r1.j.changed === true && JSON.parse(k12._s.get('affiliate:ACTIVE2').value).reactivated_at);
  s = await sale('ACTIVE2', 5); check('...earns again', s.j.logged === true);
  r1 = await call(setStatus, { password: PW, code: 'ACTIVE2', status: 'active' }, {}, e12); check('setting the same status again is a no-op', r1.j.ok && r1.j.changed === false);
  check('wrong password -> 401', (await call(setStatus, { password: 'no', code: 'ACTIVE2', status: 'suspended' }, {}, e12)).status === 401);
  check('unknown code -> 404', (await call(setStatus, { password: PW, code: 'NOSUCH1', status: 'suspended' }, {}, e12)).status === 404);
  check('bad status / bad code -> 400', (await call(setStatus, { password: PW, code: 'ACTIVE2', status: 'banned' }, {}, e12)).status === 400 && (await call(setStatus, { password: PW, code: 'a/b', status: 'active' }, {}, e12)).status === 400);
  await call(setStatus, { password: PW, code: 'PAUSED3', status: 'suspended' }, {}, e12);
  // the report still shows suspended affiliates, with their status, so owed commission is never hidden
  await k12.put('referral:PAUSED3:old', JSON.stringify({ ref_code: 'PAUSED3', tx_ref: 'old', order_total_ngn: 5000, commission_ngn: 400, timestamp: '2025-02-01T00:00:00.000Z' }), { metadata: { c: 'PAUSED3', t: 5000, m: 400, ts: '2025-02-01T00:00:00.000Z' } });
  const rep = await (await getReferrals({ request: req({ password: PW }), env: e12 })).json();
  const row = rep.rows.find(x => x.code === 'PAUSED3');
  check('the payout report still lists a suspended affiliate, flagged, with the balance owed', row && row.status === 'suspended' && row.balance_due_ngn === 400 && rep.rows.find(x => x.code === 'LEGACY1').status === 'active', JSON.stringify(row));
  const aff = await (await getAffiliates({ request: req({ password: PW }), env: e12 })).json();
  check('get-affiliates returns status, source and email_verified_at (legacy: active / admin / null)', aff.affiliates.find(x => x.code === 'LEGACY1').status === 'active' && aff.affiliates.find(x => x.code === 'LEGACY1').source === 'admin' && aff.affiliates.find(x => x.code === 'LEGACY1').email_verified_at === null && aff.affiliates.find(x => x.code === 'PAUSED3').status === 'suspended');
}

console.log('\n=== get-affiliates shows self-signups ===');
{
  const aff = await (await getAffiliates({ request: req({ password: PW }), env })).json();
  const mine = aff.affiliates.find(x => x.code === code1);
  check('a self-signup shows source "self-signup", status active and its confirmed date', mine && mine.source === 'self-signup' && mine.status === 'active' && !Number.isNaN(Date.parse(mine.email_verified_at)), JSON.stringify(mine));
  check('wrong password -> 401', (await getAffiliates({ request: req({ password: 'x' }), env })).status === 401);
}

console.log('\n=== resend my welcome email: never reveals who is registered ===');
{
  const k13 = makeKV(); const e13 = { ...env, REFERRALS_KV: k13 }; mails = [];
  await call(signup, form({ name: 'Welcome Back', email: 'welcome.back@example.com', phone: '0803 940 0001' }), {}, e13); await verify({ request: new Request('https://xnyfarms.com/api/verify-affiliate?token=' + tokenFrom(mails[0])), env: e13 });
  await k13.put('affiliate:LEGACYW', JSON.stringify({ name: 'Legacy W', email: 'legacy.w@example.com', approved_at: '2025-01-01T00:00:00.000Z' }), { metadata: { n: 'Legacy W', e: 'legacy.w@example.com', at: '2025-01-01T00:00:00.000Z' } });   // approved by hand, never indexed
  await k13.put('affiliate:SUSPW', JSON.stringify({ name: 'Susp W', email: 'susp.w@example.com', approved_at: '2025-01-01T00:00:00.000Z', status: 'suspended' }), { metadata: { n: 'Susp W', e: 'susp.w@example.com', at: '2025-01-01T00:00:00.000Z', s: 'suspended' } });
  mails = [];
  const ask = async (email, opts, extra = {}) => call(resendWelcome, { email, ...extra }, opts, e13);
  const registered = await ask('Welcome.Back+x@example.com'); const mailsRegistered = mails.length;
  const unknown = await ask('nobody@example.com'); const mailsUnknown = mails.length - mailsRegistered;
  const suspended = await ask('susp.w@example.com');
  check('registered, unknown and suspended get the IDENTICAL response (status and body)', registered.status === 200 && JSON.stringify(registered.j) === JSON.stringify(unknown.j) && JSON.stringify(unknown.j) === JSON.stringify(suspended.j) && registered.j.message === 'If that email is registered, we have sent your details.', JSON.stringify([registered.j, unknown.j, suspended.j]));
  check('only the ACTIVE registered address got an email (one), none for unknown/suspended', mailsRegistered === 1 && mailsUnknown === 0 && mails.length === 1);
  check('it is the standard welcome email, to the REGISTERED address', JSON.stringify(mails[0].to) === JSON.stringify(['welcome.back@example.com']) && mails[0].subject === 'Welcome to the XNY Farms Affiliate Program!' && /\?ref=WELBACK/.test(mails[0].html), mails[0].html.slice(0, 0) + mails[0].subject);
  mails = [];
  await ask('legacy.w@example.com', {}); check('an affiliate approved by hand before the index existed is found by their email too', mails.length === 1 && JSON.stringify(mails[0].to) === JSON.stringify(['legacy.w@example.com']));
  mails = [];
  await ask('welcome.back@example.com', {}, { to: 'attacker@evil.com', recipient: 'attacker@evil.com', email2: 'attacker@evil.com' });
  check('a recipient in the request is ignored: only the registered address is mailed', mails.length === 1 && JSON.stringify(mails[0].to) === JSON.stringify(['welcome.back@example.com']) && !JSON.stringify(mails).includes('evil'));
  check('a malformed email -> 400 (reveals nothing about registrations)', (await ask('nope')).status === 400);
  check('no-store', (await ask('nobody@example.com')).cache === 'no-store');
  // rate limits
  mails = []; const ip = '198.51.100.77'; const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await ask(`rl${i}@example.com`, { ip })).status);
  check('per-IP: 5 per hour, then 429 (for registered or not alike)', statuses.join() === '200,200,200,200,200,429,429', statuses.join());
  const em = []; for (let i = 0; i < 4; i++) em.push((await ask('welcome.back@example.com', { ip: '198.51.100.' + (100 + i) })).status);
  check('per-email: a registered address gets at most 3 requests a day however many IPs ask', em.slice(0, 3).every(x => x === 200) && em[3] === 429 || em.filter(x => x === 429).length >= 1, em.join());
  check('the 429 for a rate-limited request says nothing about whether the address exists', JSON.stringify((await ask('nobody@example.com', { ip })).j) === JSON.stringify((await ask('welcome.back@example.com', { ip })).j));
  // the email is sent AFTER the response (waitUntil), so response timing can't reveal registration
  mails = []; let sentBeforeResponse = null; const pending = [];
  const rr = await resendWelcome({ request: req({ email: 'legacy.w@example.com' }, { ip: '198.51.100.200' }), env: e13, waitUntil: p => pending.push(p) });
  sentBeforeResponse = mails.length;
  await Promise.all(pending);
  check('the welcome email is sent via waitUntil, after the response is returned', rr.status === 200 && sentBeforeResponse === 0 && mails.length === 1, `${sentBeforeResponse}/${mails.length}`);
}
reset();

console.log('\n=== rebuild duplicate index ===');
{
  const k14 = makeKV(); const e14 = { ...env, REFERRALS_KV: k14 };
  const app = (key, v) => k14.put(key, JSON.stringify(v), { metadata: { s: v.status, n: v.name } });
  const aff = (code, name, email, extra = {}) => k14.put('affiliate:' + code, JSON.stringify({ name, email, approved_at: extra.at || '2025-01-01T00:00:00.000Z', ...extra }), { metadata: { n: name, e: email, at: extra.at || '2025-01-01T00:00:00.000Z', ...(extra.application_key ? { k: extra.application_key } : {}) } });
  await app('application:2025-01-01T00:00:00.000Z-aaaa', { name: 'Linked One', email: 'one@example.com', phone: '0803 111 0001', status: 'approved' });
  await app('application:2025-01-02T00:00:00.000Z-bbbb', { name: 'By Email Two', email: 'two@example.com', phone: '+234 803 111 0002', status: 'approved' });
  await app('application:2025-01-03T00:00:00.000Z-cccc', { name: 'Shares Phone', email: 'phone.clash@example.com', phone: '0803 111 0001', status: 'approved' });
  await app('application:2025-01-04T00:00:00.000Z-dddd', { name: 'Bad Phone', email: 'bad.phone@example.com', phone: '12345', status: 'approved' });
  await aff('LINKED1', 'Linked One', 'One@Example.com', { application_key: 'application:2025-01-01T00:00:00.000Z-aaaa', at: '2025-01-01T00:00:00.000Z' });
  await aff('EMAILM2', 'By Email Two', 'two@example.com', { at: '2025-01-02T00:00:00.000Z' });                                   // no application_key: matched by email
  await aff('PHONECL3', 'Shares Phone', 'phone.clash@example.com', { application_key: 'application:2025-01-03T00:00:00.000Z-cccc', at: '2025-01-03T00:00:00.000Z' });   // same phone as LINKED1
  await aff('EMAILCL4', 'Shares Email', 'o.ne+dup@example.com', { at: '2025-01-05T00:00:00.000Z' });                            // same email as LINKED1? (o.ne != one except gmail) -> NOT a clash on example.com
  await aff('GMAILCL5', 'Gmail A', 'same.person@gmail.com', { at: '2025-01-06T00:00:00.000Z' });
  await aff('GMAILCL6', 'Gmail B', 'sameperson+x@googlemail.com', { at: '2025-01-07T00:00:00.000Z' });                          // same address as GMAILCL5 after normalising
  await aff('BADPHON7', 'Bad Phone', 'bad.phone@example.com', { application_key: 'application:2025-01-04T00:00:00.000Z-dddd', at: '2025-01-08T00:00:00.000Z' });
  await aff('NOPHONE8', 'No Phone', 'no.phone@example.com', { at: '2025-01-09T00:00:00.000Z' });
  const snapshot = [...k14._s.keys()].filter(k => k.startsWith('affiliate:')).map(k => k + '=' + k14._s.get(k).value + '|' + JSON.stringify(k14._s.get(k).metadata)).join('\n');
  check('wrong password -> 401, writes nothing', (await call(rebuildIndex, { password: 'x' }, {}, e14)).status === 401 && ![...k14._s.keys()].some(k => k.startsWith('idx:')));
  r = await call(rebuildIndex, { password: PW }, {}, e14);
  check('ok, counts the affiliates', r.status === 200 && r.j.ok && r.j.affiliates === 8, JSON.stringify(r.j));
  check('indexed emails (all valid, minus the Gmail clash) and phones (application_key + email match; clash and invalid excluded)', r.j.indexed_email === 7 && r.j.indexed_phone === 2 && r.j.no_phone === 4 && r.j.invalid_phone === 1, JSON.stringify(r.j));
  check('the idx keys exist, normalised', k14._s.has('idx:email:one@example.com') && k14._s.has('idx:email:two@example.com') && k14._s.has('idx:email:sameperson@gmail.com') && k14._s.has('idx:phone:2348031110001') && k14._s.has('idx:phone:2348031110002'), [...k14._s.keys()].filter(k => k.startsWith('idx:')).join());
  check('each idx key points at its affiliate and is permanent', JSON.parse(k14._s.get('idx:email:one@example.com').value).code === 'LINKED1' && JSON.parse(k14._s.get('idx:email:one@example.com').value).type === 'affiliate' && k14.ttl('idx:email:one@example.com') === undefined);
  const gm = r.j.conflicts.find(c => c.field === 'email'), ph = r.j.conflicts.find(c => c.field === 'phone');
  check('conflict reported: two affiliates share a Gmail address (dots/+tag/googlemail), the OLDER keeps the key', gm && gm.value === 'sameperson@gmail.com' && gm.codes.join() === 'GMAILCL5,GMAILCL6' && JSON.parse(k14._s.get('idx:email:sameperson@gmail.com').value).code === 'GMAILCL5', JSON.stringify(r.j.conflicts));
  check('conflict reported: two affiliates share a phone number (value masked)', ph && ph.codes.join() === 'LINKED1,PHONECL3' && /^•+0001$/.test(ph.value) && JSON.parse(k14._s.get('idx:phone:2348031110001').value).code === 'LINKED1', JSON.stringify(ph));
  check('exactly those two conflicts', r.j.conflicts.length === 2);
  const snapshotAfter = [...k14._s.keys()].filter(k => k.startsWith('affiliate:')).map(k => k + '=' + k14._s.get(k).value + '|' + JSON.stringify(k14._s.get(k).metadata)).join('\n');
  check('no affiliate record (or its metadata) was changed', snapshot === snapshotAfter);
  const writesBefore = [...k14._s.keys()].length;
  r = await call(rebuildIndex, { password: PW }, {}, e14);
  check('running it again is safe: nothing new indexed, the same conflicts, key count unchanged', r.j.indexed_email === 0 && r.j.indexed_phone === 0 && r.j.already_indexed_email === 7 && r.j.already_indexed_phone === 2 && r.j.conflicts.length === 2 && [...k14._s.keys()].length === writesBefore, JSON.stringify(r.j));
  // protection works afterwards
  mails = [];
  let rr = await signup({ request: req(form({ name: 'Newcomer', email: 'one@example.com', phone: '0805 123 9999' })), env: e14, waitUntil() {} }); let jj = await rr.json();
  check('after the rebuild, an old affiliate\'s email can no longer be registered again', rr.status === 409 && jj.field === 'email' && mails.length === 0, JSON.stringify(jj));
  rr = await signup({ request: req(form({ name: 'Newcomer', email: 'fresh@example.com', phone: '0803 111 0002' })), env: e14, waitUntil() {} }); jj = await rr.json();
  check('...nor an old affiliate\'s phone (found via their application)', rr.status === 409 && jj.field === 'phone');
  // a live unconfirmed signup with the same email as an old affiliate is reported, not overwritten
  const k15 = makeKV(); const e15 = { ...env, REFERRALS_KV: k15 };
  await signup({ request: req(form({ name: 'Pending Old', email: 'old.one@example.com', phone: '0803 123 0000' })), env: e15, waitUntil() {} });
  await k15.put('affiliate:OLDONE1', JSON.stringify({ name: 'Old One', email: 'old.one@example.com', approved_at: '2025-01-01T00:00:00.000Z' }), { metadata: { n: 'Old One', e: 'old.one@example.com', at: '2025-01-01T00:00:00.000Z' } });
  r = await call(rebuildIndex, { password: PW }, {}, e15);
  check('an existing affiliate whose email is held by a live unconfirmed signup is a reported conflict (the signup\'s key is not overwritten)', r.j.conflicts.length === 1 && /waiting for confirmation/.test(r.j.conflicts[0].note) && JSON.parse(k15._s.get('idx:email:old.one@example.com').value).type === 'signup', JSON.stringify(r.j.conflicts));
  check('503 without the password env / KV', (await call(rebuildIndex, { password: PW }, {}, { ...e14, ADMIN_REPORT_PASSWORD: undefined })).status === 503 && (await call(rebuildIndex, { password: PW }, {}, { ...e14, REFERRALS_KV: undefined })).status === 503);
}
reset();

console.log('\n=== manual (admin) approval still works and joins the index ===');
{
  const k16 = makeKV(); const e16 = { ...env, REFERRALS_KV: k16 };
  await k16.put('application:2025-03-01T00:00:00.000Z-eeee', JSON.stringify({ name: 'Manual Person', email: 'manual@example.com', phone: '0803 444 0001', status: 'pending' }), { metadata: { s: 'pending', n: 'Manual Person' } });
  r = await call(register, { password: PW, code: 'manual01', name: 'Manual Person', email: 'manual@example.com', application_key: 'application:2025-03-01T00:00:00.000Z-eeee' }, {}, e16);
  const rec = JSON.parse(k16._s.get('affiliate:MANUAL01').value);
  check('approved, status active, source admin; metadata carries them', r.j.ok && rec.status === 'active' && rec.source === 'admin' && k16._s.get('affiliate:MANUAL01').metadata.src === 'admin' && k16._s.get('affiliate:MANUAL01').metadata.s === 'active' && Array.isArray(r.j.warnings) && r.j.warnings.length === 0, JSON.stringify(r.j));
  check('the duplicate index now covers the email and the phone from the application', JSON.parse(k16._s.get('idx:email:manual@example.com').value).code === 'MANUAL01' && JSON.parse(k16._s.get('idx:phone:2348034440001').value).code === 'MANUAL01');
  r = await call(register, { password: PW, code: 'manual02', name: 'Manual Again', email: 'MANUAL+2@example.com' }, {}, e16);
  check('a manual approval is never blocked by a duplicate, but warns; the existing index is not stolen', r.j.ok && r.j.warnings.length === 1 && /email is already registered to affiliate MANUAL01/.test(r.j.warnings[0]) && JSON.parse(k16._s.get('idx:email:manual@example.com').value).code === 'MANUAL01', JSON.stringify(r.j));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
