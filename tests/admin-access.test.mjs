/**
 * Tests for the admin gate's Cloudflare Access layer and the audit log.
 *
 *   node tests/admin-access.test.mjs
 *
 * Real WebCrypto RSA signatures with a generated keypair and a mocked JWKS endpoint; in-memory KV; fake clock.
 */
import fs from 'node:fs';
import { verifyAccessJwt, resetAccessCache, adminDenied, ADMIN_API_PATHS } from '../functions/_lib/admin-auth.js';
import { onRequestPost as adminPricing } from '../functions/api/admin-pricing.js';
import { onRequestPost as getAffiliates } from '../functions/api/get-affiliates.js';
import { onRequestPost as getPending } from '../functions/api/get-pending-applications.js';
import { onRequestPost as getReferrals } from '../functions/api/get-referrals.js';
import { onRequestPost as rebuildIndex } from '../functions/api/rebuild-index.js';
import { onRequestPost as recordPayout } from '../functions/api/record-payout.js';
import { onRequestPost as registerAffiliate } from '../functions/api/register-affiliate.js';
import { onRequestPost as sendEmail } from '../functions/api/send-affiliate-email.js';
import { onRequestPost as setStatus } from '../functions/api/set-affiliate-status.js';
import { onRequestPost as adminStatusPost, onRequestGet as adminStatusGet } from '../functions/api/admin-status.js';
import { onRequestPost as auditLog } from '../functions/api/get-audit-log.js';
import { onRequest as middleware, ADMIN_RESPONSE_HEADERS } from '../functions/api/_middleware.js';
import { onRequestGet as pricingGet } from '../functions/api/pricing.js';
import { onRequestPost as createOrder } from '../functions/api/create-order.js';
import { onRequestPost as verifyOrder } from '../functions/api/verify-order.js';
import { onRequestPost as webhook } from '../functions/api/flutterwave-webhook.js';
import { onRequestPost as logReferral } from '../functions/api/log-referral.js';
import { onRequestGet as myStats } from '../functions/api/get-my-stats.js';
import { onRequestPost as submitApplication } from '../functions/api/submit-affiliate-application.js';
import { onRequestGet as verifyAffiliate } from '../functions/api/verify-affiliate.js';
import { onRequestPost as resendConfirmation } from '../functions/api/resend-confirmation.js';
import { onRequestPost as resendWelcome } from '../functions/api/resend-welcome.js';
import { makeKey, jwksDoc, claims, sign, signHs256WithPublicKey, unsigned, b64uJson, b64u, TEAM, AUD } from './helpers/access-jwt.mjs';

let NOW = Date.parse('2026-10-28T09:00:00.000Z');
Date.now = () => NOW;
const advance = (ms) => { NOW += ms; };

function makeKV() {
  const s = new Map();
  const kv = { _s: s, failAudit: false,
    ttl: (k) => s.get(k)?.ttl,
    async put(k, v, o = {}) { if (kv.failAudit && k.startsWith('audit:')) throw new Error('KV down'); s.set(k, { value: v, metadata: o.metadata ?? null, ttl: o.expirationTtl, expiresAt: o.expirationTtl ? NOW + o.expirationTtl * 1000 : null }); },
    async get(k) { const e = s.get(k); if (!e) return null; if (e.expiresAt && e.expiresAt <= NOW) { s.delete(k); return null; } return e.value; },
    async delete(k) { s.delete(k); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const all = [...s.keys()].filter((k) => k.startsWith(prefix) && (!s.get(k).expiresAt || s.get(k).expiresAt > NOW)).sort();
      const st = cursor ? Number(cursor) : 0, sl = all.slice(st, st + limit), n = st + limit;
      return { keys: sl.map((name) => ({ name, metadata: s.get(name).metadata })), cursor: n < all.length ? String(n) : undefined, list_complete: n >= all.length }; } };
  return kv;
}
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, String(x).slice(0, 400))); };

/* ---- mocked JWKS + Resend ---- */
const KEY_A = await makeKey('kid-a');
const KEY_B = await makeKey('kid-b');
const KEY_EVIL = await makeKey('kid-a');                 // same kid as A, a different private key
let jwks = [KEY_A];
let jwksMode = 'ok';                                     // ok | down | http500 | junk
let jwksFetches = 0;
let mails = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u === `https://${TEAM}/cdn-cgi/access/certs`) {
    jwksFetches++;
    if (jwksMode === 'down') throw new TypeError('network down');
    if (jwksMode === 'http500') return new Response('oops', { status: 500 });
    if (jwksMode === 'junk') return new Response(JSON.stringify({ nope: true }), { status: 200 });
    return new Response(JSON.stringify(jwksDoc(...jwks)), { status: 200 });
  }
  mails.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ id: 're_' + mails.length }), { status: 200 });
};
const reset = () => { resetAccessCache(); jwks = [KEY_A]; jwksMode = 'ok'; jwksFetches = 0; };

const PW = 'correct horse battery';
const ACCESS = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
const tokenFor = (over = {}, key = KEY_A, headerOver = {}) => sign(key, claims(NOW, over), headerOver);
const envWith = (kv, extra = {}) => ({ REFERRALS_KV: kv, ADMIN_REPORT_PASSWORD: PW, RESEND_API_KEY: 're_x', FLW_SECRET_KEY: 'FLWSECK-x', FLW_SECRET_HASH: 'hash-x', ...extra });
let ipN = 0; const nextIp = () => `198.51.100.${(++ipN % 250) + 1}`;
const post = (body, headers = {}, ip, host = 'xnyfarms.com') => new Request(`https://${host}/api/x`, { method: 'POST', body: JSON.stringify(body), headers: { 'CF-Connecting-IP': ip || nextIp(), ...headers } });
const call = async (fn, body, { env, jwt, ip, host, headers = {} } = {}) => {
  const h = { ...headers }; if (jwt) h['Cf-Access-Jwt-Assertion'] = jwt;
  const r = await fn({ request: post(body, h, ip, host), env });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* */ }
  return { status: r.status, j, text: t, headers: r.headers };
};

console.log('=== verifyAccessJwt: what is accepted ===');
{
  reset();
  const env = { ...ACCESS };
  let r = await verifyAccessJwt(await tokenFor(), env);
  check('a correctly signed RS256 token for our team and audience is accepted, with its email', r.ok === true && r.email === 'admin@xnyfarms.com', JSON.stringify(r));
  check('...and the keys came from https://<team>/cdn-cgi/access/certs, once', jwksFetches === 1);
  r = await verifyAccessJwt(await tokenFor(), env);
  check('keys are cached: a second verification does not fetch again', r.ok && jwksFetches === 1);
  advance(9 * 60e3);
  r = await verifyAccessJwt(await tokenFor(), env);
  check('still cached after 9 minutes', r.ok && jwksFetches === 1);
  advance(61e3);
  r = await verifyAccessJwt(await tokenFor(), env);
  check('refetched once the 10-minute cache has expired', r.ok && jwksFetches === 2);
  reset();
  r = await verifyAccessJwt(await tokenFor({ aud: AUD }), env);
  check('aud may be a plain string', r.ok);
  r = await verifyAccessJwt(await tokenFor({ aud: ['other', AUD] }), env);
  check('aud may be an array that merely contains ours', r.ok);
  r = await verifyAccessJwt(await tokenFor({ exp: Math.floor(NOW / 1000) - 10 }), env);
  check('expired 10 s ago is inside the 30 s clock leeway', r.ok);
  r = await verifyAccessJwt(await tokenFor({ nbf: Math.floor(NOW / 1000) + 10 }), env);
  check('nbf 10 s in the future is inside the 30 s leeway', r.ok);
  r = await verifyAccessJwt(await tokenFor(), { CF_ACCESS_TEAM_DOMAIN: `https://${TEAM}/`, CF_ACCESS_AUD: AUD });
  check('the team domain may be written with https:// and a trailing slash', r.ok);
}

console.log('\n=== verifyAccessJwt: what is refused ===');
{
  const env = { ...ACCESS };
  const bad = async (label, token, reason, e = env) => { const r = await verifyAccessJwt(token, e); check(`${label} -> refused${reason ? ' (' + reason + ')' : ''}`, r.ok === false && (!reason || r.reason === reason), JSON.stringify(r)); };
  reset();
  await bad('expired (2 minutes ago)', await tokenFor({ exp: Math.floor(NOW / 1000) - 120 }), 'expired');
  await bad('no exp claim at all', await tokenFor({ exp: undefined }), 'expired');
  await bad('exp as a string', await tokenFor({ exp: String(Math.floor(NOW / 1000) + 3600) }), 'expired');
  await bad('nbf an hour in the future', await tokenFor({ nbf: Math.floor(NOW / 1000) + 3600 }), 'not_yet_valid');
  await bad('wrong audience', await tokenFor({ aud: ['someone-elses-app'] }), 'bad_aud');
  await bad('no audience', await tokenFor({ aud: undefined }), 'bad_aud');
  await bad('wrong issuer', await tokenFor({ iss: 'https://evil.cloudflareaccess.com' }), 'bad_iss');
  await bad('issuer without https://', await tokenFor({ iss: TEAM }), 'bad_iss');
  await bad('no email claim (a service token is not an admin)', await tokenFor({ email: undefined }), 'no_email');
  await bad('an email claim that is not an email', await tokenFor({ email: 'nobody' }), 'no_email');
  const good = await tokenFor();
  const [h, p, s] = good.split('.');
  const forged = { ...claims(NOW), email: 'attacker@evil.com' };
  await bad('a tampered payload with the original signature', `${h}.${b64uJson(forged)}.${s}`, 'bad_signature');
  await bad('a payload with one character flipped', `${h}.${p.slice(0, -2)}${p.slice(-2) === 'AA' ? 'BB' : 'AA'}.${s}`);
  await bad('a signature from a different private key (same kid)', await tokenFor({}, KEY_EVIL), 'bad_signature');
  await bad('a truncated signature', `${h}.${p}.${s.slice(0, 40)}`, 'bad_signature');
  await bad('an empty signature', `${h}.${p}.`, 'malformed');
  await bad('alg "none" with no signature', unsigned(KEY_A, claims(NOW)), 'malformed');
  await bad('alg "none" with a junk signature', unsigned(KEY_A, claims(NOW)) + 'AAAA', 'bad_alg');
  await bad('alg "None" / "NONE"', unsigned(KEY_A, claims(NOW), 'None') + 'AAAA', 'bad_alg');
  await bad('alg HS256 "signed" with the public key as the secret', await signHs256WithPublicKey(KEY_A, claims(NOW)), 'bad_alg');
  await bad('alg RS384 (only RS256 is allowed) even with a valid RS256 signature', await tokenFor({}, KEY_A, { alg: 'RS384' }), 'bad_alg');
  await bad('alg ES256', await tokenFor({}, KEY_A, { alg: 'ES256' }), 'bad_alg');
  await bad('no alg in the header', await tokenFor({}, KEY_A, { alg: undefined }), 'bad_alg');
  await bad('no kid in the header', await tokenFor({}, KEY_A, { kid: undefined }), 'no_kid');
  await bad('garbage', 'not-a-jwt', 'malformed');
  await bad('two segments only', `${h}.${p}`, 'malformed');
  await bad('four segments', `${h}.${p}.${s}.${s}`, 'malformed');
  await bad('empty string', '', 'missing');
  await bad('undefined', undefined, 'missing');
  await bad('a 20 KB token', 'a'.repeat(20000), 'missing');
  await bad('payload that is not JSON', `${h}.${b64u(Buffer.from('nope'))}.${s}`, 'malformed');
  await bad('payload that is a JSON array', `${h}.${b64uJson([1])}.${s}`);
  await bad('valid token but no team domain configured', good, 'not_configured', { CF_ACCESS_AUD: AUD });
  await bad('valid token but no audience configured', good, 'not_configured', { CF_ACCESS_TEAM_DOMAIN: TEAM });
  await bad('a team domain with a path or spaces in it is treated as not configured', good, 'not_configured', { CF_ACCESS_TEAM_DOMAIN: 'evil.com/x y', CF_ACCESS_AUD: AUD });
}

console.log('\n=== verifyAccessJwt: key rotation and JWKS failures ===');
{
  reset();
  const env = { ...ACCESS };
  await verifyAccessJwt(await tokenFor(), env);                  // cache holds kid-a only
  jwks = [KEY_A, KEY_B]; const before = jwksFetches;             // Cloudflare rotates in kid-b
  let r = await verifyAccessJwt(await tokenFor({}, KEY_B), env);
  check('an unknown kid triggers exactly ONE refetch, and the new key then verifies', r.ok && jwksFetches === before + 1, `${r.reason} ${jwksFetches - before}`);
  r = await verifyAccessJwt(await tokenFor({}, KEY_B), env);
  check('and it is cached from then on', r.ok && jwksFetches === before + 1);
  const KEY_C = await makeKey('kid-c');
  advance(31e3);                                                 // (the 30 s cooldown after the kid-b refetch)
  const t0 = jwksFetches;
  r = await verifyAccessJwt(await tokenFor({}, KEY_C), env);
  check('a kid that is still unknown after the refetch is refused (unknown_kid), after one refetch only', r.ok === false && r.reason === 'unknown_kid' && jwksFetches === t0 + 1);
  for (let i = 0; i < 5; i++) await verifyAccessJwt(await tokenFor({}, KEY_C), env);
  check('a flood of unknown kids cannot make us hammer Cloudflare: no further refetch inside 30 s', jwksFetches === t0 + 1, jwksFetches - t0);
  advance(31e3);
  await verifyAccessJwt(await tokenFor({}, KEY_C), env);
  check('after 30 s one more refetch is allowed', jwksFetches === t0 + 2);

  reset(); jwksMode = 'down';
  r = await verifyAccessJwt(await tokenFor(), env);
  check('JWKS endpoint unreachable -> refused (jwks_unavailable), never accepted', r.ok === false && r.reason === 'jwks_unavailable');
  jwksMode = 'http500'; resetAccessCache();
  check('JWKS endpoint answering 500 -> refused', (await verifyAccessJwt(await tokenFor(), env)).reason === 'jwks_unavailable');
  jwksMode = 'junk'; resetAccessCache();
  check('JWKS endpoint answering junk -> refused', (await verifyAccessJwt(await tokenFor(), env)).reason === 'jwks_unavailable');
  jwksMode = 'ok';
  check('...and recovers as soon as the endpoint does', (await verifyAccessJwt(await tokenFor(), env)).ok === true);
  jwksMode = 'down'; advance(11 * 60e3);
  check('a cache that has expired while Cloudflare is down is NOT trusted (fail closed)', (await verifyAccessJwt(await tokenFor(), env)).ok === false);
  jwksMode = 'ok';
}

/* ---- endpoint fixtures ---- */
const seed = async (kv) => {
  await kv.put('affiliate:ADA01', JSON.stringify({ name: 'Ada Eze', email: 'ada.eze@example.com', approved_at: '2026-01-01T00:00:00.000Z', status: 'active', application_key: 'application:app1' }), { metadata: { n: 'Ada Eze', e: 'ada.eze@example.com', at: '2026-01-01T00:00:00.000Z', s: 'active' } });
  await kv.put('application:app1', JSON.stringify({ name: 'Ada Eze', email: 'ada.eze@example.com', phone: '08031230000', bank_name: 'Test Bank', account_number: '0123456789', status: 'approved' }), { metadata: { s: 'approved', n: 'Ada Eze', at: 'x' } });
};
const ENDPOINTS = {
  'admin-pricing': [adminPricing, () => ({ action: 'get' })],
  'get-affiliates': [getAffiliates, () => ({})],
  'get-pending-applications': [getPending, () => ({})],
  'get-referrals': [getReferrals, () => ({})],
  'rebuild-index': [rebuildIndex, () => ({})],
  'record-payout': [recordPayout, () => ({ code: 'ADA01', amount_ngn: 1000, paid_on: '2026-10-27', reference: 'REF-1' })],
  'register-affiliate': [registerAffiliate, () => ({ check_only: true, code: 'NEWCODE1' })],
  'send-affiliate-email': [sendEmail, () => ({ code: 'ADA01' })],
  'set-affiliate-status': [setStatus, () => ({ code: 'ADA01', status: 'active' })],
  'admin-status': [adminStatusPost, () => ({})],
  'get-audit-log': [auditLog, () => ({})]
};
const NINE = ['admin-pricing', 'get-affiliates', 'get-pending-applications', 'get-referrals', 'rebuild-index', 'record-payout', 'register-affiliate', 'send-affiliate-email', 'set-affiliate-status'];

console.log('\n=== the gate list matches the endpoints that really call adminDenied ===');
{
  const users = fs.readdirSync(new URL('../functions/api/', import.meta.url)).filter((f) => f.endsWith('.js')).filter((f) => /adminDenied\(/.test(fs.readFileSync(new URL('../functions/api/' + f, import.meta.url), 'utf8'))).map((f) => f.replace(/\.js$/, '')).sort();
  check('ADMIN_API_PATHS is exactly the files that call adminDenied (so the middleware covers them all)', JSON.stringify(users) === JSON.stringify([...ADMIN_API_PATHS].sort()), users.join());
  check('and the test table covers every one of them', JSON.stringify(Object.keys(ENDPOINTS).sort()) === JSON.stringify([...ADMIN_API_PATHS].sort()));
}

console.log('\n=== ACCESS_ENFORCE on, but not configured: every admin endpoint fails closed (403) ===');
for (const [label, extra] of [['no Access variables at all', {}], ['only the team domain', { CF_ACCESS_TEAM_DOMAIN: TEAM }], ['only the audience', { CF_ACCESS_AUD: AUD }], ['an invalid team domain', { CF_ACCESS_TEAM_DOMAIN: 'bad domain/', CF_ACCESS_AUD: AUD }]]) {
  reset();
  const kv = makeKV(); await seed(kv);
  const env = envWith(kv, { ACCESS_ENFORCE: 'true', ...extra });
  const out = [];
  for (const name of Object.keys(ENDPOINTS)) {
    const [fn, body] = ENDPOINTS[name];
    const r = await call(fn, { password: PW, ...body() }, { env, jwt: await tokenFor() });   // correct password AND a (valid-looking) JWT
    out.push(`${name}:${r.status}${r.j && r.j.code === 'access_required' ? '' : '!'}`);
  }
  check(`${label}: all ${out.length} admin endpoints answer 403 access_required, even with the right password`, out.every((x) => /:403$/.test(x)), out.join(' '));
}

console.log('\n=== ACCESS_ENFORCE on and configured ===');
{
  reset();
  const kv = makeKV(); await seed(kv);
  const env = envWith(kv, { ACCESS_ENFORCE: 'true', ...ACCESS });
  const good = await tokenFor();
  const results = {};
  for (const name of NINE) {
    const [fn, body] = ENDPOINTS[name];
    const noJwt = await call(fn, { password: PW, ...body() }, { env });
    const badJwt = await call(fn, { password: PW, ...body() }, { env, jwt: await tokenFor({ exp: 1 }) });
    const expired = await call(fn, { password: PW, ...body() }, { env, jwt: await tokenFor({ aud: ['x'] }) });
    results[name] = [noJwt.status, badJwt.status, expired.status];
  }
  check('all nine admin endpoints reject the CORRECT password with no JWT (403)', NINE.every((n) => results[n][0] === 403), JSON.stringify(results));
  check('...and with an expired JWT, and with a JWT for another audience', NINE.every((n) => results[n][1] === 403 && results[n][2] === 403));
  const ok = {};
  for (const name of NINE) { const [fn, body] = ENDPOINTS[name]; ok[name] = (await call(fn, { password: PW, ...body() }, { env, jwt: good })).status; }
  check('with a valid JWT AND the correct password each of them works (200)', NINE.every((n) => ok[n] === 200), JSON.stringify(ok));
  const wrong = await call(getReferrals, { password: 'nope' }, { env, jwt: good });
  check('a valid JWT with the WRONG password is still refused (401): Access is in addition to the password', wrong.status === 401 && wrong.j.error === 'Incorrect password.');
  const kv2 = makeKV(); const env2 = envWith(kv2, { ACCESS_ENFORCE: 'true', ...ACCESS });
  for (let i = 0; i < 15; i++) await call(getReferrals, { password: 'guess' + i }, { env: env2, ip: '203.0.113.50' });
  check('no JWT means the password is never even looked at: no failure counters are written', ![...kv2._s.keys()].some((k) => k.startsWith('rl:adminfail')));
  const ip = '203.0.113.51'; const st = [];
  for (let i = 0; i < 12; i++) st.push((await call(getReferrals, { password: 'guess' + i }, { env: env2, jwt: good, ip })).status);
  check('with a valid JWT the password lockout still applies (10 wrong -> 429, even for the right password)', st.slice(0, 10).every((x) => x === 401) && st[10] === 429 && (await call(getReferrals, { password: PW }, { env: env2, jwt: good, ip })).status === 429, st.join());
  const noJwtOnLocked = await call(getReferrals, { password: PW }, { env: env2, ip });
  check('a locked-out IP with no JWT still gets 403 (Access is checked first)', noJwtOnLocked.status === 403);
  const a = await call(getReferrals, { password: PW }, { env, jwt: good, host: 'xnyfarms.com' });
  const b = await call(getReferrals, { password: PW }, { env, jwt: good, host: 'localhost:8788' });
  const c = await call(getReferrals, { password: PW }, { env, host: 'localhost:8788' });
  const d = await call(getReferrals, { password: PW }, { env, host: 'preview-123.xny-farms.pages.dev' });
  check('enforcement depends on the variable only, never the hostname: localhost and a preview URL are enforced exactly like production', a.status === 200 && b.status === 200 && c.status === 403 && d.status === 403);
  const hdr = await call(getReferrals, { password: PW }, { env });
  check('the 403 says what to do and leaks no configuration', /Cloudflare Access/.test(hdr.j.error) && !JSON.stringify(hdr.j).includes(TEAM) && !JSON.stringify(hdr.j).includes(AUD));
}

console.log('\n=== ACCESS_ENFORCE not exactly "true": behaves as today (and is the break-glass) ===');
for (const value of [undefined, '', 'false', 'True', 'TRUE', '1', 'yes', ' true', 'true ']) {
  reset();
  const kv = makeKV(); await seed(kv);
  const env = envWith(kv, { ...(value === undefined ? {} : { ACCESS_ENFORCE: value }), ...ACCESS });
  const rs = [];
  for (const name of NINE) { const [fn, body] = ENDPOINTS[name]; rs.push((await call(fn, { password: PW, ...body() }, { env })).status); }
  const wrong = await call(getReferrals, { password: 'x' }, { env });
  check(`ACCESS_ENFORCE=${JSON.stringify(value)}: password alone works on all nine; a wrong password is 401`, rs.every((x) => x === 200) && wrong.status === 401, rs.join());
}
{
  reset();
  const kv = makeKV(); await seed(kv);
  const env = envWith(kv, { ACCESS_ENFORCE: 'false' });   // no Access variables at all
  const r = await call(getReferrals, { password: PW }, { env, jwt: 'garbage.garbage.garbage' });
  check('not enforcing and not configured: even a junk JWT header is simply ignored', r.status === 200);
  const env2 = envWith(kv, { ...ACCESS });
  const r2 = await call(getReferrals, { password: PW }, { env: env2, jwt: await tokenFor({ exp: 1 }) });
  check('not enforcing: an INVALID JWT is ignored (password-only), not an error', r2.status === 200);
  const fetchesBefore = jwksFetches;
  const lockIp = '203.0.113.60'; const sts = [];
  for (let i = 0; i < 11; i++) sts.push((await call(getReferrals, { password: 'g' + i }, { env: env2, ip: lockIp })).status);
  check('the lockout is unchanged when not enforcing', sts[9] === 401 && sts[10] === 429, sts.join());
  void fetchesBefore;
}

console.log('\n=== admin-status ===');
{
  reset();
  const kv = makeKV(); const good = await tokenFor();
  let env = envWith(kv, { ...ACCESS });
  let r = await call(adminStatusPost, { password: PW }, { env });
  check('not enforced, configured, no JWT: { access_enforced:false, access_configured:true, access_jwt_valid:false, admin_email:null }', r.status === 200 && r.j.ok && r.j.access_enforced === false && r.j.access_configured === true && r.j.access_jwt_valid === false && r.j.admin_email === null, r.text);
  r = await call(adminStatusPost, { password: PW }, { env, jwt: good });
  check('not enforced but a valid JWT is present: it is used (jwt_valid true, the email shown)', r.j.access_enforced === false && r.j.access_jwt_valid === true && r.j.admin_email === 'admin@xnyfarms.com');
  r = await call(adminStatusPost, { password: PW }, { envWith: 0, env: envWith(kv) });
  check('nothing configured: access_configured false', r.j.access_configured === false && r.j.access_enforced === false);
  env = envWith(kv, { ACCESS_ENFORCE: 'true', ...ACCESS });
  r = await call(adminStatusPost, { password: PW }, { env, jwt: good });
  check('enforced with a valid JWT: access_enforced true, jwt_valid true, email', r.j.access_enforced === true && r.j.access_jwt_valid === true && r.j.admin_email === 'admin@xnyfarms.com');
  check('it never returns the team domain or the audience', !r.text.includes(TEAM) && !r.text.includes(AUD));
  r = await call(adminStatusPost, { password: 'wrong' }, { env, jwt: good });
  check('wrong password -> 401', r.status === 401);
  r = await call(adminStatusPost, { password: PW }, { env });
  check('enforced and no JWT -> 403', r.status === 403);
  const g = async (pw, jwt) => { const h = { 'CF-Connecting-IP': nextIp() }; if (pw !== null) h['X-Admin-Password'] = pw; if (jwt) h['Cf-Access-Jwt-Assertion'] = jwt; const res = await adminStatusGet({ request: new Request('https://xnyfarms.com/api/admin-status', { headers: h }), env }); return { status: res.status, j: await res.json() }; };
  let gr = await g(PW, good);
  check('GET works with the password in an X-Admin-Password header (never the URL)', gr.status === 200 && gr.j.admin_email === 'admin@xnyfarms.com');
  check('GET with no or a wrong password -> 401', (await g(null, good)).status === 401 && (await g('nope', good)).status === 401);
  const cacheHdr = (await adminStatusPost({ request: post({ password: PW }, { 'Cf-Access-Jwt-Assertion': good }), env })).headers.get('Cache-Control');
  check('no-store', cacheHdr === 'no-store');
}

console.log('\n=== the audit log ===');
const auditRecords = (kv) => [...kv._s.entries()].filter(([k]) => k.startsWith('audit:')).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => ({ key: k, ttl: v.ttl, meta: v.metadata, rec: JSON.parse(v.value) }));
const lastAudit = (kv) => auditRecords(kv).at(-1);
{
  reset();
  const kv = makeKV(); await seed(kv);
  const SECRET_JWT = await tokenFor();
  const env = envWith(kv, { ACCESS_ENFORCE: 'true', ...ACCESS });
  const A = (fn, body, ip = '203.0.113.70') => call(fn, { password: PW, ...body }, { env, jwt: SECRET_JWT, ip });
  let r = await A(adminPricing, { action: 'save', products: { 'palm-oil-50cl': { price_ngn: 780 } }, note: 'palm oil up' });
  let e = lastAudit(kv);
  check('pricing save writes an entry: action, actor email, IP, summary with the version and the change', r.j.ok && e.rec.action === 'pricing.save' && e.rec.actor_email === 'admin@xnyfarms.com' && e.rec.actor_ip === '203.0.113.70' && /version 2/.test(e.rec.summary) && /Palm Oil 50cl price ₦700 → ₦780/.test(e.rec.summary), JSON.stringify(e.rec));
  check('the key is audit:{ISO time}-{10 hex}, it expires after 400 days, and the metadata mirrors the record', /^audit:\d{4}-\d\d-\d\dT[\d:.]+Z-[a-f0-9]{10}$/.test(e.key) && e.key.startsWith('audit:' + e.rec.at + '-') && e.ttl === 400 * 86400 && JSON.stringify(e.meta) === JSON.stringify(e.rec));
  check('the record has exactly { at, actor_email, actor_ip, action, summary }', JSON.stringify(Object.keys(e.rec).sort()) === JSON.stringify(['action', 'actor_email', 'actor_ip', 'at', 'summary']) && e.rec.at === new Date(NOW).toISOString());
  const snap = JSON.parse(await kv.get('pricing:v2'));
  check('the new pricing version carries changed_by', snap.changed_by === 'admin@xnyfarms.com');
  advance(1000);
  r = await A(adminPricing, { action: 'revert_to', version: 1, note: 'undo' });
  e = lastAudit(kv);
  check('pricing revert writes an entry naming both versions', r.j.ok && e.rec.action === 'pricing.revert' && /Reverted to version 1, saved as version 3/.test(e.rec.summary) && JSON.parse(await kv.get('pricing:v3')).changed_by === 'admin@xnyfarms.com', JSON.stringify(e.rec));
  const hist = await A(adminPricing, { action: 'history' });
  check('the version history shows who changed each version (and v1, the built-in seed, none)', hist.j.versions[0].changed_by === 'admin@xnyfarms.com' && hist.j.versions.at(-1).changed_by === null, JSON.stringify(hist.j.versions.map((v) => v.changed_by)));
  const pub = await (await pricingGet({ request: new Request('https://xnyfarms.com/api/pricing'), env })).text();
  check('the public pricing API leaks neither changed_by nor any email', !pub.includes('changed_by') && !pub.includes('admin@xnyfarms.com'));
  r = await A(adminPricing, { action: 'preview', products: { 'palm-oil-50cl': { price_ngn: 900 } } });
  const n0 = auditRecords(kv).length;
  await A(adminPricing, { action: 'get' }); await A(getReferrals, {}); await A(getAffiliates, {}); await A(getPending, {}); await A(adminStatusPost, {}); await A(auditLog, {});
  check('previews and read-only calls write nothing', auditRecords(kv).length === n0);

  advance(1000);
  r = await A(recordPayout, { code: 'ADA01', amount_ngn: 12500.5, paid_on: '2026-10-27', reference: 'TRF-SECRET-REF-9', note: 'private note', email_receipt: true });
  e = lastAudit(kv);
  check('a payout writes an entry with the amount, code and date, and whether the receipt went out', r.j.recorded && e.rec.action === 'payout.recorded' && /₦12,500\.5 to ADA01, paid on 2026-10-27; receipt emailed/.test(e.rec.summary), JSON.stringify(e.rec));
  const payoutKey = r.j.key;
  check('the payout record carries recorded_by', JSON.parse(await kv.get(payoutKey)).recorded_by === 'admin@xnyfarms.com');
  advance(1000);
  r = await A(recordPayout, { payout_key: payoutKey });
  check('resending a receipt writes an entry', r.j.ok && lastAudit(kv).rec.action === 'payout.receipt_resent' && lastAudit(kv).rec.summary.includes(payoutKey));
  advance(1000);
  r = await A(recordPayout, { delete_key: payoutKey });
  check('deleting a payout writes an entry', r.j.ok && lastAudit(kv).rec.action === 'payout.deleted' && lastAudit(kv).rec.summary.includes(payoutKey));
  advance(1000);
  r = await A(registerAffiliate, { code: 'NEWCODE1', name: 'New Person', email: 'new.person@example.com', application_key: 'application:app1' });
  e = lastAudit(kv);
  check('registering an affiliate writes an entry with the code and name', r.j.ok && e.rec.action === 'affiliate.registered' && /NEWCODE1 \(New Person\)/.test(e.rec.summary), JSON.stringify(e.rec));
  advance(1000);
  r = await A(setStatus, { code: 'ADA01', status: 'suspended' });
  check('suspending writes an entry', lastAudit(kv).rec.action === 'affiliate.suspended' && /Suspended ADA01 \(Ada Eze\)/.test(lastAudit(kv).rec.summary));
  advance(1000);
  const nBefore = auditRecords(kv).length;
  await A(setStatus, { code: 'ADA01', status: 'suspended' });
  check('suspending someone who is already suspended changes nothing and writes nothing', auditRecords(kv).length === nBefore);
  r = await A(setStatus, { code: 'ADA01', status: 'active' });
  check('reactivating writes an entry', lastAudit(kv).rec.action === 'affiliate.reactivated' && /Reactivated ADA01/.test(lastAudit(kv).rec.summary));
  advance(1000);
  r = await A(sendEmail, { code: 'ADA01' });
  check('resending a welcome email writes an entry (no email address in it)', r.j.ok && lastAudit(kv).rec.action === 'affiliate.welcome_resent' && /ADA01 \(Ada Eze\)/.test(lastAudit(kv).rec.summary) && !/@/.test(lastAudit(kv).rec.summary));
  advance(1000);
  r = await A(rebuildIndex, {});
  e = lastAudit(kv);
  check('rebuilding the index writes an entry with the counts', r.j.ok && e.rec.action === 'index.rebuilt' && /Rebuilt the duplicate index for \d+ affiliates/.test(e.rec.summary), JSON.stringify(e.rec));
  const ipL = '203.0.113.80';
  for (let i = 0; i < 12; i++) await call(getReferrals, { password: 'secretguess' + i }, { env, jwt: SECRET_JWT, ip: ipL });
  const lockouts = auditRecords(kv).filter((x) => x.rec.action === 'admin.lockout');
  check('a lockout writes ONE entry (not one per refused request), with the IP and the verified email', lockouts.length === 1 && lockouts[0].rec.actor_ip === ipL && lockouts[0].rec.actor_email === 'admin@xnyfarms.com' && /Locked out after 10 wrong passwords/.test(lockouts[0].rec.summary), JSON.stringify(lockouts));

  const everything = JSON.stringify([...kv._s.entries()].filter(([k]) => k.startsWith('audit:')));
  const leaks = ['correct horse', PW, 'secretguess', '0123456789', 'TRF-SECRET-REF-9', 'private note', 'ada.eze@example.com', 'new.person@example.com', SECRET_JWT, SECRET_JWT.split('.')[2], 'FLWSECK', 're_x', 'palm oil up', 'Test Bank', '08031230000'].filter((x) => everything.includes(x));
  check('no audit entry (value or metadata) contains a password, wrong guess, account number, payout reference or note, affiliate email, phone, bank name, token or JWT', leaks.length === 0, leaks.join());
  check('every entry is within KV\'s 1024-byte metadata limit', auditRecords(kv).every((x) => new TextEncoder().encode(JSON.stringify(x.meta)).length <= 1024));
}
{
  reset();
  const kv = makeKV(); await seed(kv); const env = envWith(kv);
  await call(adminPricing, { password: PW, action: 'save', products: { 'palm-oil-50cl': { price_ngn: 790 } } }, { env });
  check('without Access the actor is "password-only"', lastAudit(kv).rec.actor_email === 'password-only');
  check('...and the pricing version says so', JSON.parse(await kv.get('pricing:v2')).changed_by === 'password-only');
  const r = await call(recordPayout, { password: PW, code: 'ADA01', amount_ngn: 100, paid_on: '2026-10-27' }, { env });
  check('...and so does the payout', JSON.parse(await kv.get(r.j.key)).recorded_by === 'password-only');
  advance(1000);
  const withJwt = await call(recordPayout, { password: PW, code: 'ADA01', amount_ngn: 100, paid_on: '2026-10-27' }, { env: envWith(kv, { ...ACCESS }), jwt: await tokenFor({ email: 'finance@xnyfarms.com' }) });
  check('not enforcing, but a valid JWT is present: its email is used as the actor', JSON.parse(await kv.get(withJwt.j.key)).recorded_by === 'finance@xnyfarms.com' && lastAudit(kv).rec.actor_email === 'finance@xnyfarms.com');
  kv.failAudit = true;
  const ok = await call(recordPayout, { password: PW, code: 'ADA01', amount_ngn: 200, paid_on: '2026-10-27' }, { env });
  check('if the audit write fails (KV error) the action itself still succeeds', ok.status === 200 && ok.j.recorded === true && !!(await kv.get(ok.j.key)));
  kv.failAudit = false;
  advance(1000);
  const evil = '\u0000\u0007bad\n' + 'x'.repeat(2000);
  await call(registerAffiliate, { password: PW, code: 'LONG001', name: evil, email: 'long@example.com' }, { env });
  const e = lastAudit(kv);
  check('control characters are stripped and an absurdly long name is capped so the entry still fits', e.rec.summary.length <= 300 && !/[\u0000-\u001f]/.test(e.rec.summary) && new TextEncoder().encode(JSON.stringify(e.meta)).length <= 1024, e.rec.summary.length);
}

console.log('\n=== get-audit-log ===');
{
  reset();
  const kv = makeKV(); const env = envWith(kv);
  for (let i = 0; i < 250; i++) { advance(1000); await kv.put(`audit:${new Date(NOW).toISOString()}-${String(i).padStart(10, '0')}`, JSON.stringify({}), { expirationTtl: 400 * 86400, metadata: { at: new Date(NOW).toISOString(), actor_email: 'a@b.c', actor_ip: '1.1.1.1', action: 'test.action', summary: 'entry ' + i } }); }
  const r = await call(auditLog, { password: PW }, { env });
  check('returns the newest 200, newest first, and the total kept', r.status === 200 && r.j.entries.length === 200 && r.j.total === 250 && r.j.entries[0].summary === 'entry 249' && r.j.entries[199].summary === 'entry 50', `${r.j.entries.length} ${r.j.total} ${r.j.entries[0].summary}`);
  check('each entry has exactly time, who, IP, action, summary', JSON.stringify(Object.keys(r.j.entries[0]).sort()) === JSON.stringify(['action', 'actor_email', 'actor_ip', 'at', 'summary']));
  check('no-store', r.headers.get('Cache-Control') === 'no-store');
  check('wrong password -> 401; no password -> 401', (await call(auditLog, { password: 'x' }, { env })).status === 401 && (await call(auditLog, {}, { env })).status === 401);
  const enforced = envWith(kv, { ACCESS_ENFORCE: 'true', ...ACCESS });
  check('enforced: no JWT -> 403, valid JWT -> 200', (await call(auditLog, { password: PW }, { env: enforced })).status === 403 && (await call(auditLog, { password: PW }, { env: enforced, jwt: await tokenFor() })).status === 200);
  const empty = await call(auditLog, { password: PW }, { env: envWith(makeKV()) });
  check('an empty log is an empty list', empty.j.ok && empty.j.entries.length === 0 && empty.j.total === 0);
  check('invalid JSON -> 400', (await auditLog({ request: new Request('https://x', { method: 'POST', body: 'x', headers: { 'CF-Connecting-IP': nextIp() } }), env })).status === 400);
  advance(401 * 86400e3);
  check('entries expire after 400 days', (await call(auditLog, { password: PW }, { env })).j.entries.length === 0);
}

console.log('\n=== admin headers on the admin APIs (middleware) ===');
{
  const run = async (path, base = new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } })) => middleware({ request: new Request('https://xnyfarms.com/api/' + path), next: async () => base });
  for (const name of ADMIN_API_PATHS) {
    const res = await run(name);
    const h = (k) => res.headers.get(k);
    if (!(h('Cache-Control') === 'no-store' && h('X-Frame-Options') === 'DENY' && h('Content-Security-Policy') === "frame-ancestors 'none'" && h('Referrer-Policy') === 'no-referrer' && h('X-Content-Type-Options') === 'nosniff' && h('Content-Type') === 'application/json')) check(`/api/${name} headers`, false, [...res.headers.entries()].join());
  }
  check(`all ${ADMIN_API_PATHS.length} admin APIs get no-store, X-Frame-Options DENY, CSP frame-ancestors 'none', Referrer-Policy no-referrer, nosniff (and keep their content type)`, true);
  const pub = await run('pricing');
  check('a public endpoint is returned untouched (its own cache header kept, nothing added)', pub.headers.get('Cache-Control') === 'public, max-age=30' && !pub.headers.get('X-Frame-Options'));
  const trailing = await run('get-referrals/');
  check('a trailing slash does not dodge it', trailing.headers.get('X-Frame-Options') === 'DENY');
  const body = await (await run('get-referrals')).text();
  check('the body passes through intact', body === '{}');
  check('(the header set is the one documented)', Object.keys(ADMIN_RESPONSE_HEADERS).length === 5);
}

console.log('\n=== public endpoints keep working with NO Access login, even when enforcing ===');
{
  reset();
  const kv = makeKV(); await seed(kv);
  const env = envWith(kv, { ACCESS_ENFORCE: 'true', ...ACCESS });       // enforcing, and no request below carries a JWT
  const notBlocked = (r) => r.status !== 403 || (r.j && r.j.code !== 'access_required');
  const get = async (fn, url) => { const res = await fn({ request: new Request(url, { headers: { 'CF-Connecting-IP': nextIp() } }), env }); const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* */ } return { status: res.status, j, text: t, headers: res.headers }; };
  let r = await get(pricingGet, 'https://xnyfarms.com/api/pricing');
  check('pricing: 200 with the prices', r.status === 200 && r.j.products && r.j.version >= 1, r.text.slice(0, 100));
  r = await call(createOrder, { items: [{ id: 'palm-oil-50cl', qty: 1 }], fulfilment: 'pickup', customer: { name: 'Buyer One', email: 'buyer@example.com', phone: '08031234567', address: '' } }, { env });
  check('create-order: 200 with a tx_ref', r.status === 200 && r.j.ok && /^xny-/.test(r.j.tx_ref), r.text.slice(0, 100));
  r = await call(verifyOrder, { tx_ref: 'xny-1700000000000-deadbeef' }, { env });
  check('verify-order: answers (state "unknown") instead of 403', r.status === 200 && r.j.state === 'unknown', r.text);
  r = await call(webhook, { event: 'transfer.completed', data: {} }, { env, headers: { 'verif-hash': 'hash-x' } });
  check('flutterwave-webhook: a correctly signed event is accepted (200)', r.status === 200 && r.j.ignored === true, r.text);
  r = await call(webhook, { event: 'charge.completed', data: {} }, { env, headers: { 'verif-hash': 'wrong' } });
  check('flutterwave-webhook: judged by its own signature check (401), not by Access', r.status === 401 && notBlocked(r));
  r = await call(logReferral, { tx_ref: 'x' }, { env });
  check('log-referral: 200', r.status === 200 && notBlocked(r), r.text);
  r = await get(myStats, 'https://xnyfarms.com/api/get-my-stats?code=ADA01');
  check('get-my-stats: 200 with the totals', r.status === 200 && r.j.ok === true, r.text.slice(0, 100));
  r = await call(submitApplication, {}, { env });
  check('submit-affiliate-application: reaches its own validation (400), not a 403', r.status === 400 && notBlocked(r), r.text.slice(0, 120));
  const res = await verifyAffiliate({ request: new Request('https://xnyfarms.com/api/verify-affiliate?token=bad', { headers: { 'CF-Connecting-IP': nextIp() } }), env });
  check('verify-affiliate: redirects to the confirmation page like normal (not a 403)', res.status >= 300 && res.status < 400 && /affiliate-confirmed\.html/.test(res.headers.get('Location')), `${res.status} ${res.headers.get('Location')}`);
  r = await call(resendConfirmation, {}, { env });
  check('resend-confirmation: reaches its own validation (not a 403)', r.status !== 403 && r.status < 500 && notBlocked(r), `${r.status} ${r.text}`);
  r = await call(resendWelcome, {}, { env });
  check('resend-welcome: reaches its own validation (not a 403)', r.status !== 403 && r.status < 500 && notBlocked(r), `${r.status} ${r.text}`);
  check('none of those ten touched the JWKS endpoint or wrote an audit entry', jwksFetches === 0 && auditRecords(kv).length === 0, `${jwksFetches} ${auditRecords(kv).length}`);
}

console.log('\n=== _headers: what each admin page really gets (Cloudflare joins duplicate values with a comma unless detached) ===');
{
  const text = fs.readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  const rules = []; let cur = null;
  for (const raw of text.split('\n')) { if (!raw.trim() || raw.trim().startsWith('#')) continue; if (!/^\s/.test(raw)) { cur = { path: raw.trim(), lines: [] }; rules.push(cur); } else cur.lines.push(raw.trim()); }
  const effective = (path) => {
    const h = new Map();
    for (const rule of rules) {
      const matches = rule.path === path || rule.path === '/*' || (rule.path.endsWith('/*') && path.startsWith(rule.path.slice(0, -1)));
      if (!matches) continue;
      for (const line of rule.lines) {
        if (line.startsWith('!')) { h.delete(line.slice(1).trim().toLowerCase()); continue; }
        const i = line.indexOf(':'); const name = line.slice(0, i).trim().toLowerCase(); const value = line.slice(i + 1).trim();
        h.set(name, h.has(name) ? h.get(name) + ', ' + value : value);
      }
    }
    return h;
  };
  for (const page of ['admin.html', 'admin-referrals.html', 'admin-pricing.html', 'admin-approve-affiliate.html']) {
    const h = effective('/' + page);
    check(`/${page}: no-store, DENY, frame-ancestors 'none', no-referrer, nosniff, noindex (each value single, none joined)`,
      h.get('cache-control') === 'no-store' && h.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(h.get('content-security-policy')) && !/frame-ancestors 'self'/.test(h.get('content-security-policy')) && !/,/.test(h.get('content-security-policy')) && h.get('referrer-policy') === 'no-referrer' && h.get('x-content-type-options') === 'nosniff' && /noindex/.test(h.get('x-robots-tag')) && h.get('strict-transport-security') === 'max-age=31536000', JSON.stringify([...h]));
  }
  const pub = effective('/index.html');
  check('a public page is unchanged: SAMEORIGIN framing, the site referrer policy, a CSP that allows same-origin framing', pub.get('x-frame-options') === 'SAMEORIGIN' && pub.get('referrer-policy') === 'strict-origin-when-cross-origin' && /frame-ancestors 'self'/.test(pub.get('content-security-policy')));
  check('affiliate-confirmed.html has a single no-referrer value', effective('/affiliate-confirmed.html').get('referrer-policy') === 'no-referrer');
}

console.log('\n=== the admin pages ===');
{
  const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  for (const page of ['admin.html', 'admin-referrals.html', 'admin-pricing.html', 'admin-approve-affiliate.html'])
    check(`${page}: has the protection banner and loads admin-common.js before its own script`, /id="access-banner"/.test(read(page)) && read(page).indexOf('admin-common.js') > 0 && read(page).indexOf('admin-common.js') < read(page).search(/js\/admin-(hub|pricing|referrals|approve-affiliate)\.js/));
  for (const f of ['js/admin-pricing.js', 'js/admin-referrals.js', 'js/admin-approve-affiliate.js', 'js/admin-hub.js'])
    check(`${f}: calls the API through XNYAdmin.request (so an expired session is caught), not raw fetch`, /XNYAdmin\.request/.test(read(f)) && !/window\.fetch\(\s*(ENDPOINT|url)/.test(read(f)));
  check('admin.html has the Activity log section', /Activity log/.test(read('admin.html')) && /id="audit-list"/.test(read('admin.html')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
