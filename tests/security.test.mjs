/**
 * Security tests: admin brute-force lockout across every admin endpoint, the public stats throttle,
 * and the response headers in _headers.
 *   node tests/security.test.mjs
 */
import fs from 'node:fs';
import { onRequestPost as adminPricing } from '../functions/api/admin-pricing.js';
import { onRequestPost as getAffiliates } from '../functions/api/get-affiliates.js';
import { onRequestPost as getPending } from '../functions/api/get-pending-applications.js';
import { onRequestPost as getReferrals } from '../functions/api/get-referrals.js';
import { onRequestPost as rebuildIndex } from '../functions/api/rebuild-index.js';
import { onRequestPost as recordPayout } from '../functions/api/record-payout.js';
import { onRequestPost as registerAffiliate } from '../functions/api/register-affiliate.js';
import { onRequestPost as sendEmail } from '../functions/api/send-affiliate-email.js';
import { onRequestPost as setStatus } from '../functions/api/set-affiliate-status.js';
import { onRequestGet as myStats } from '../functions/api/get-my-stats.js';

let NOW = Date.parse('2026-10-28T09:00:00.000Z');
Date.now = () => NOW;
function makeKV() {
  const s = new Map();
  return { _s: s,
    async put(k, v, o = {}) { s.set(k, { value: v, metadata: o.metadata ?? null, expiresAt: o.expirationTtl ? NOW + o.expirationTtl * 1000 : null }); },
    async get(k) { const e = s.get(k); if (!e) return null; if (e.expiresAt && e.expiresAt <= NOW) { s.delete(k); return null; } return e.value; },
    async delete(k) { s.delete(k); },
    async list({ prefix = '' } = {}) { const keys = [...s.keys()].filter((k) => k.startsWith(prefix)); return { keys: keys.map((name) => ({ name, metadata: s.get(name).metadata })), list_complete: true }; } };
}
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, String(x).slice(0, 300))); };
globalThis.fetch = async () => new Response(JSON.stringify({ id: 'x' }), { status: 200 });

const PW = 'correct horse battery';
const ENDPOINTS = { adminPricing, getAffiliates, getPending, getReferrals, rebuildIndex, recordPayout, registerAffiliate, sendEmail, setStatus };
const hit = async (fn, env, password, ip) => (await fn({ request: new Request('https://xnyfarms.com/api/x', { method: 'POST', body: JSON.stringify({ password }), headers: { 'CF-Connecting-IP': ip } }), env })).status;

console.log('=== admin brute-force lockout (every admin endpoint) ===');
for (const [name, fn] of Object.entries(ENDPOINTS)) {
  const env = { REFERRALS_KV: makeKV(), ADMIN_REPORT_PASSWORD: PW, RESEND_API_KEY: 're_x' };
  const bad = [];
  for (let i = 0; i < 10; i++) bad.push(await hit(fn, env, 'guess' + i, '203.0.113.5'));
  const eleventh = await hit(fn, env, 'guess11', '203.0.113.5');
  const right = await hit(fn, env, PW, '203.0.113.5');
  const other = await hit(fn, env, PW, '203.0.113.99');
  check(`${name}: 10 wrong passwords -> 401, the 11th -> 429, even the RIGHT password is refused while locked, another IP is unaffected`,
    bad.every((x) => x === 401) && eleventh === 429 && right === 429 && other !== 401 && other !== 429, JSON.stringify({ bad, eleventh, right, other }));
}
{
  const env = { REFERRALS_KV: makeKV(), ADMIN_REPORT_PASSWORD: PW };
  for (let i = 0; i < 9; i++) await hit(getReferrals, env, 'bad', '198.51.100.1');
  const ok = await hit(getReferrals, env, PW, '198.51.100.1');
  for (let i = 0; i < 9; i++) await hit(getReferrals, env, 'bad', '198.51.100.1');
  const still = await hit(getReferrals, env, PW, '198.51.100.1');
  check('a successful sign-in clears the counter (9 wrong, right, 9 wrong, right still works)', ok === 200 && still === 200, `${ok} ${still}`);
  for (let i = 0; i < 10; i++) await hit(getReferrals, env, 'bad', '198.51.100.2');
  check('locked', (await hit(getReferrals, env, PW, '198.51.100.2')) === 429);
  NOW += 15 * 60e3 + 1000;
  check('the lock lifts by itself after 15 minutes', (await hit(getReferrals, env, PW, '198.51.100.2')) === 200);
  const r = await getReferrals({ request: new Request('https://x', { method: 'POST', body: JSON.stringify({ password: 'a' }), headers: { 'CF-Connecting-IP': '198.51.100.3' } }), env });
  check('the failure message does not reveal whether the password was close', (await r.json()).error === 'Incorrect password.');
}
{
  const env = { REFERRALS_KV: makeKV(), ADMIN_REPORT_PASSWORD: PW };
  const lockedBody = async () => await (await getReferrals({ request: new Request('https://x', { method: 'POST', body: JSON.stringify({ password: 'a' }), headers: { 'CF-Connecting-IP': '198.51.100.4' } }), env })).json();
  for (let i = 0; i < 10; i++) await lockedBody();
  const j = await lockedBody();
  check('the 429 tells the admin how long to wait', /Try again in \d+ minute/.test(j.error), j.error);
}

console.log('\n=== the public my-stats lookup is throttled ===');
{
  const env = { REFERRALS_KV: makeKV() };
  const st = [];
  for (let i = 0; i < 62; i++) st.push((await myStats({ request: new Request('https://x/api/get-my-stats?code=GUESS' + i, { headers: { 'CF-Connecting-IP': '192.0.2.8' } }), env })).status);
  check('60 lookups per 10 minutes per IP, then 429 with Retry-After', st[59] === 200 && st[60] === 429 && st[61] === 429, st.slice(58).join());
  const other = (await myStats({ request: new Request('https://x/api/get-my-stats?code=ABC', { headers: { 'CF-Connecting-IP': '192.0.2.9' } }), env })).status;
  check('another visitor is unaffected', other === 200);
  NOW += 10 * 60e3 + 1000;
  check('the window resets', (await myStats({ request: new Request('https://x/api/get-my-stats?code=ABC', { headers: { 'CF-Connecting-IP': '192.0.2.8' } }), env })).status === 200);
}

console.log('\n=== _headers ===');
{
  const text = fs.readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  const blocks = {}; let cur = null;
  for (const line of text.split('\n')) { if (!line.trim() || line.trim().startsWith('#')) continue; if (!/^\s/.test(line)) { cur = line.trim(); blocks[cur] = []; } else blocks[cur].push(line.trim()); }
  const all = blocks['/*'].join('\n');
  check('every page: nosniff, clickjacking protection, referrer policy, permissions policy', /X-Content-Type-Options: nosniff/.test(all) && /X-Frame-Options: SAMEORIGIN/.test(all) && /Referrer-Policy:/.test(all) && /Permissions-Policy:/.test(all));
  check('HSTS for a year', /Strict-Transport-Security: max-age=31536000/.test(all));
  check('CSP: no plugins, fixed <base>, same-origin framing and form posts', /Content-Security-Policy: .*object-src 'none'/.test(all) && /base-uri 'self'/.test(all) && /frame-ancestors 'self'/.test(all) && /form-action 'self'/.test(all));
  check('the CSP does not restrict scripts (Flutterwave and Turnstile must still load)', !/script-src|default-src/.test(all));
  for (const page of ['admin.html', 'admin-referrals.html', 'admin-pricing.html', 'admin-approve-affiliate.html', 'affiliate-confirmed.html'])
    check(`/${page}: not cached and not indexed`, blocks['/' + page] && blocks['/' + page].some((l) => /Cache-Control: no-store/.test(l)) && blocks['/' + page].some((l) => /noindex/.test(l)));
}

console.log('\n=== secrets are not in the repo or shipped to the browser ===');
{
  const { execSync } = await import('node:child_process');
  const out = execSync("git ls-files 'js/*' '*.html' 'css/*' 'assets/*' 2>/dev/null || true", { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).split('\n').filter(Boolean);
  const hits = [];
  for (const f of out) { if (/\.(png|jpe?g|webp|ico|woff2?)$/i.test(f)) continue; const t = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'); if (/FLWSECK|FLW_SECRET|re_[A-Za-z0-9]{20,}|ADMIN_REPORT_PASSWORD/.test(t)) hits.push(f); }
  check('no Flutterwave secret key, Resend key or admin password name appears in any browser-served file', hits.length === 0, hits.join());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
