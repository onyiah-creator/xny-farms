/**
 * Tests for the affiliate welcome email and its admin endpoints.
 *
 *   node tests/send-affiliate-email.test.mjs
 *
 * No dependencies, no network: KV and Resend are mocked in memory, so this
 * checks exactly what WOULD be sent. It cannot tell you how Gmail will render
 * it; for that, send a real email to a test affiliate.
 */
import { onRequestPost as sendEmail, buildWelcomeEmail } from '../functions/api/send-affiliate-email.js';
import { onRequestPost as getAffiliates } from '../functions/api/get-affiliates.js';
import { onRequestPost as registerAff } from '../functions/api/register-affiliate.js';

function makeKV(){ const s=new Map(); return { _s:s,
  async put(k,v,o={}){ s.set(k,{value:v,metadata:o.metadata??null}); },
  async get(k){ return s.has(k)?s.get(k).value:null; },
  async list({prefix='',cursor,limit=1000}={}){ const all=[...s.keys()].filter(k=>k.startsWith(prefix)).sort();
    const st=cursor?Number(cursor):0, sl=all.slice(st,st+limit), n=st+limit;
    return { keys:sl.map(name=>({name,metadata:s.get(name).metadata})), cursor:n<all.length?String(n):undefined, list_complete:n>=all.length }; }};}
const post=b=>new Request('https://x/api',{method:'POST',body:JSON.stringify(b)});
let pass=0,fail=0; const check=(n,c,x='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,x));};

// ---- mock Resend (global fetch) ----
let calls=[]; let resendReply=()=>new Response(JSON.stringify({id:'re_abc123'}),{status:200});
globalThis.fetch = async (url, init) => { calls.push({url, init}); return resendReply(url, init); };

const KV=makeKV();
const env={REFERRALS_KV:KV, ADMIN_REPORT_PASSWORD:'admin-pw', RESEND_API_KEY:'re_test_SECRET_KEY'};
await registerAff({request:post({password:'admin-pw',code:'ADEBAYO01',name:'Adebayo Okafor',email:'adebayo@example.com'}),env});

console.log('=== the Resend request ===');
let r = await sendEmail({request:post({password:'admin-pw',code:'ADEBAYO01'}),env});
let j = await r.json();
check('succeeds', r.status===200 && j.ok===true, JSON.stringify(j));
check('reports who it was sent to', j.sent_to==='adebayo@example.com');
check('returns the Resend message id', j.id==='re_abc123');
check('exactly one call to Resend', calls.length===1);
const c = calls[0]; const sent = JSON.parse(c.init.body);
check('POSTs to https://api.resend.com/emails', c.url==='https://api.resend.com/emails' && c.init.method==='POST', c.url);
check('Authorization: Bearer <key>', c.init.headers.Authorization==='Bearer re_test_SECRET_KEY');
check('Content-Type JSON', c.init.headers['Content-Type']==='application/json');
check('from is the verified sender', sent.from==='XNY Farms <affiliates@xnyfarms.com>', sent.from);
check('to is the affiliate on file', JSON.stringify(sent.to)===JSON.stringify(['adebayo@example.com']));
check('reply_to goes to the monitored inbox', sent.reply_to==='xnyfarms@gmail.com');
check('subject matches the existing copy', sent.subject==='Welcome to the XNY Farms Affiliate Program!');
check('sends an HTML body', /<html/.test(sent.html) && sent.html.length>2000);
check('ALSO sends a plain-text alternative', typeof sent.text==='string' && sent.text.length>200);
check('API key is NOT in the response', !JSON.stringify(j).includes('SECRET_KEY'));
check('API key is NOT in the email body', !sent.html.includes('SECRET_KEY') && !sent.text.includes('SECRET_KEY'));

console.log('\n=== the email itself ===');
const html = sent.html;
const anchors = [...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m=>({href:m[1],label:m[2].replace(/<[^>]+>/g,'').trim()}));
console.log('   links in the HTML:', JSON.stringify(anchors));
const ref = anchors.find(a=>/Referral Link/.test(a.label));
const stats = anchors.find(a=>/Earnings/.test(a.label));
const xl = anchors.find(a=>/Follow us on X/.test(a.label));
check('referral link is a styled BUTTON', !!ref && ref.href==='https://xnyfarms.com/?ref=ADEBAYO01');
check('stats link is a styled BUTTON', !!stats && stats.href==='https://xnyfarms.com/my-stats.html?code=ADEBAYO01');
check('X link points at https://x.com/xnyfarms', !!xl && xl.href==='https://x.com/xnyfarms');
check('only 3 links total (spam filters dislike link-heavy mail)', anchors.length===3, 'got '+anchors.length);
check('no raw URL printed as visible text in the HTML body',
  !/>\s*https?:\/\/[^<]*</.test(html.replace(/<a [^>]*>[\s\S]*?<\/a>/g,'')));
check('shows the code', html.includes('ADEBAYO01'));
check('greets by name', html.includes('Hi Adebayo Okafor,'));
check('states 8% commission', /8% commission/.test(html));
check('has the verification/payment terms', /confirmed and paid after XNY Farms verifies each order/.test(html));
check('signature: contact info present', html.includes('xnyfarms@gmail.com') && html.includes('+234 806 013 8299'));
check('X icon is an <img> (inline SVG is stripped by Gmail)', /<img src="https:\/\/xnyfarms\.com\/assets\/email\/x-icon-white\.png"/.test(html) && !/<svg/i.test(html));
check('no <script> / no inline SVG', !/<script|<svg/i.test(html));
check('plain text carries the raw URLs', sent.text.includes('https://xnyfarms.com/?ref=ADEBAYO01') && sent.text.includes('https://x.com/xnyfarms'));


console.log('\n=== button colour contract ===');
// -- colour maths --
const hexRgb = h => { const m = /^#([0-9a-f]{6})$/i.exec(h); if (!m) throw new Error('not a #rrggbb colour: ' + h); const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgbHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const luminance = h => { const [r, g, b] = hexRgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const hsl = h => { const [r, g, b] = hexRgb(h).map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1));
  const hu = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(hu * 60 + 360) % 360, s, l]; };
const fromHsl = (h, s, l) => { const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return rgbHex([f(0) * 255, f(8) * 255, f(4) * 255]); };
const hsvSat = h => { const [r, g, b] = hexRgb(h); const mx = Math.max(r, g, b); return mx ? (mx - Math.min(r, g, b)) / mx : 0; };
const hsvVal = h => Math.max(...hexRgb(h)) / 255;

// -- a MODEL of the Gmail-Android dark-mode behaviour reported, not an emulator --
//   text:  dark text has its lightness inverted (hue kept), light text is left alone
//   fills: pale, low-chroma fills (white, cream, mint) are inverted; saturated
//          colours (yellow) and already-dark fills are left alone
//   images are never touched
const gmailText = t => { const [h, s, l] = hsl(t); return l < 0.5 ? fromHsl(h, s, 1 - l) : t; };
const gmailFill = f => { const [h, s, l] = hsl(f); return (l >= 0.5 && hsvSat(f) < 0.5) ? fromHsl(h, s, 1 - l) : f; };

// A known, reported-and-unverifiable risk is a WARNING, not a pass and not a failure:
// we can't run Gmail here, and a permanently red test teaches people to ignore it.
const warnings = [];
const warn = (name, detail) => { warnings.push(name); console.log('  WARN', name, detail || ''); };

// The model is only worth anything if it catches the ORIGINAL bug: dark green
// text (#043d1e) on yellow (#dad905) came out as a pale mint on unchanged yellow.
const oldText = gmailText('#043d1e'), oldFill = gmailFill('#dad905');
const oldContrast = contrast(oldText, oldFill);
check(`model reproduces the reported failure: #043d1e text becomes ${oldText} on unchanged yellow (contrast ${oldContrast.toFixed(2)}:1)`,
  oldFill === '#dad905' && oldText !== '#043d1e' && oldContrast < 3, oldContrast);

// -- pull the buttons out of the real rendered HTML --
const style = (s, prop) => { const m = new RegExp('(?:^|;)\\s*' + prop + ':\\s*([^;]+)', 'i').exec(s || ''); return m ? m[1].trim() : null; };
const cells = [...html.matchAll(/<td\b([^>]*class="btn-cell"[^>]*)>([\s\S]*?)<\/td>/g)].map(m => {
  const attrs = m[1], inner = m[2];
  const a = /<a\b[^>]*class="btn-link"[^>]*style="([^"]*)"/.exec(inner);
  const span = /<span class="btn-text btn-text--(\w+)" style="([^"]*)">([\s\S]*?)<\/span>/.exec(inner);
  return { bgcolorAttr: (/bgcolor="([^"]+)"/.exec(attrs) || [])[1], tdStyle: (/style="([^"]*)"/.exec(attrs) || [])[1],
           aStyle: a && a[1], tone: span && span[1], spanStyle: span && span[2], label: span && span[3].replace(/<[^>]+>/g, '').trim(),
           icon: span && /<img[^>]*src="([^"]+)"/.exec(span[3]) };
});
check('finds all 3 buttons (referral, earnings, X)', cells.length === 3, cells.length);
const [referralBtn, earningsBtn, xBtn] = cells;

// -- rules that hold for EVERY button, whatever its colours --
for (const b of cells) {
  const tag = `"${b.label}"`, fill = b.bgcolorAttr, text = style(b.aStyle, 'color');
  check(`${tag}: bgcolor attribute on the <td>`, /^#[0-9a-f]{6}$/i.test(fill), fill);
  check(`${tag}: same fill as inline background-color on <td> AND <a>`,
    style(b.tdStyle, 'background-color') === fill && style(b.aStyle, 'background-color') === fill);
  check(`${tag}: text colour is !important on the <a>`, /^#[0-9a-f]{6} !important$/i.test(text), text);
  check(`${tag}: nested <span> has the SAME text colour, also !important`, style(b.spanStyle, 'color') === text, style(b.spanStyle, 'color'));
  const cr = contrast(text.replace(' !important', ''), fill);
  check(`${tag}: readable in light mode, ${cr.toFixed(1)}:1 (AA needs 4.5)`, cr >= 4.5, cr);
}

// -- the two dark buttons are unchanged: white on dark, and safe under the model --
for (const b of [earningsBtn, xBtn]) {
  const tag = `"${b.label}"`, fill = b.bgcolorAttr;
  check(`${tag}: dark fill (luminance ${luminance(fill).toFixed(3)} < 0.1) with #ffffff text`,
    luminance(fill) < 0.1 && style(b.aStyle, 'color') === '#ffffff !important');
  const after = contrast(gmailText('#ffffff'), gmailFill(fill));
  check(`${tag}: still ${after.toFixed(1)}:1 after the Gmail dark-mode model`, after >= 7 && gmailFill(fill) === fill);
}
check('earnings button is #0b4124', earningsBtn.bgcolorAttr.toLowerCase() === '#0b4124');
check('X pill uses the WHITE icon on its dark fill', xBtn.icon && /\/assets\/email\/x-icon-white\.png$/.test(xBtn.icon[1]), xBtn.icon && xBtn.icon[1]);
check('email no longer references the black x-icon.png', !/x-icon\.png/.test(html));

// -- the yellow button: brand yellow fill, GREEN lettering --
const refFill = referralBtn.bgcolorAttr.toLowerCase(), refText = style(referralBtn.aStyle, 'color').replace(' !important', '').toLowerCase();
check('referral button fill is the brand yellow #dad905', refFill === '#dad905', refFill);
check('referral button lettering is the brand green #06552a', refText === '#06552a', refText);
const [refHue, refSat] = hsl(refText);
check(`lettering is genuinely green (hue ${Math.round(refHue)}deg, 90-170)`, refHue >= 90 && refHue <= 170 && refSat > 0.4, refHue);
check('referral button ring matches its fill, so both big buttons are the same size',
  /border:2px solid #dad905/i.test(referralBtn.tdStyle) && /border:2px solid #0b4124/i.test(earningsBtn.tdStyle));
check('the two big buttons are distinguishable', refFill !== earningsBtn.bgcolorAttr.toLowerCase());

// -- yellow is allowed in exactly one place: that button. Nothing else bright. --
const fills = [...new Set([...html.matchAll(/bgcolor="(#[0-9a-f]{6})"/gi), ...html.matchAll(/background-color:\s*(#[0-9a-f]{6})/gi)].map(m => m[1].toLowerCase()))];
const bright = fills.filter(f => hsvVal(f) >= 0.6 && hsvSat(f) >= 0.4);
check(`the only bright saturated fill is the referral button's yellow (fills in use: ${fills.join(' ')})`,
  bright.length === 1 && bright[0] === '#dad905', bright.join(' '));
check('no OTHER element is placed on the yellow',
  cells.filter(b => b.bgcolorAttr.toLowerCase() === '#dad905').length === 1);

// -- dark-mode declarations: each button keeps ITS OWN colour (a blanket white would break the yellow one) --
check('<meta name="color-scheme" content="light dark">', /<meta name="color-scheme" content="light dark">/.test(html));
check('<meta name="supported-color-schemes" content="light dark">', /<meta name="supported-color-schemes" content="light dark">/.test(html));
const darkBlock = (/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\s*\}\s*\n/.exec(html) || [])[1] || '';
check('dark block keeps the light buttons white', /\.btn-text--light\s*\{\s*color:\s*#ffffff !important/.test(darkBlock), darkBlock.trim());
check('dark block keeps the yellow button GREEN', /\.btn-text--green\s*\{\s*color:\s*#06552a !important/.test(darkBlock), darkBlock.trim());
check('dark block does NOT force one colour on every button (that would put white on yellow)',
  !/(?:^|[,{\s])\.btn-text\s*[,{]/.test(darkBlock) && !/color:\s*#ffffff[^}]*\.btn-text--green/.test(darkBlock));
check('the plain-text version is unaffected (no markup)', !/<|style=/.test(sent.text));

// -- the thing this change cannot guarantee: Gmail-Android dark mode on the yellow button --
const refAfter = contrast(gmailText(refText), gmailFill(refFill));
if (refAfter >= 4.5) {
  check(`referral button still ${refAfter.toFixed(1)}:1 after the Gmail dark-mode model`, true);
} else {
  warn(`UNVERIFIED: under the modelled Gmail dark mode the yellow button's ${refText} lettering becomes ` +
       `${gmailText(refText)} on unchanged yellow, ${refAfter.toFixed(2)}:1.`,
       '\n         The model is built from the original report, not Gmail itself, so this is a prediction. Test on a real Android device in dark mode.');
}
console.log(warnings.length ? `\n  (${warnings.length} warning${warnings.length > 1 ? 's' : ''}: not failures, but not verified either)` : '');

console.log('\n=== HTML injection via a hostile applicant name ===');
const evil = buildWelcomeEmail({name:'<a href="https://evil.example">Click</a><script>alert(1)</script>', code:'ABC123'});
check('name is escaped, not live markup', !evil.html.includes('<a href="https://evil.example"') && !evil.html.includes('<script>alert') && evil.html.includes('&lt;a href=&quot;https://evil.example&quot;'));
check('still only the 3 legitimate links', [...evil.html.matchAll(/<a\s[^>]*href=/g)].length===3);

console.log('\n=== access control ===');
calls=[];
r = await sendEmail({request:post({password:'wrong',code:'ADEBAYO01'}),env});
check('wrong password -> 401', r.status===401); check('  ...and NO email sent', calls.length===0);
r = await sendEmail({request:post({code:'ADEBAYO01'}),env});
check('no password -> 401, no email', r.status===401 && calls.length===0);
r = await sendEmail({request:post({password:'admin-pw',code:'NOSUCHCODE'}),env});
j = await r.json();
check('unknown code -> 404 (refuses to announce a non-existent approval)', r.status===404 && calls.length===0, r.status);
check('  with a helpful consistency hint', /try again/i.test(j.error));
for (const bad of ['', 'AB', 'BAD CODE', 'x'.repeat(40), 'a/b']) {
  const rr = await sendEmail({request:post({password:'admin-pw',code:bad}),env});
  check(`invalid code ${JSON.stringify(bad).slice(0,14)} -> 400`, rr.status===400);
}
check('none of those reached Resend', calls.length===0);

console.log('\n=== recipient cannot be redirected ===');
calls=[];
r = await sendEmail({request:post({password:'admin-pw',code:'ADEBAYO01',email:'attacker@evil.com',to:'attacker@evil.com',name:'X',link:'https://evil.example'}),env});
const s2 = JSON.parse(calls[0].init.body);
check('client-supplied email/to/link are ignored', JSON.stringify(s2.to)===JSON.stringify(['adebayo@example.com']) && !s2.html.includes('evil'));

console.log('\n=== resend works for any existing affiliate ===');
await registerAff({request:post({password:'admin-pw',code:'CHINWE22',name:'Chinwe Eze',email:'chinwe@example.com'}),env});
calls=[];
r = await sendEmail({request:post({password:'admin-pw',code:'chinwe22'}),env});   // lowercase
j = await r.json();
check('lowercase code normalised, sent to Chinwe', j.ok && j.sent_to==='chinwe@example.com' && JSON.parse(calls[0].init.body).html.includes('CHINWE22'));

console.log('\n=== Resend failures are surfaced, not swallowed ===');
resendReply=()=>new Response(JSON.stringify({statusCode:403,name:'validation_error',message:'The xnyfarms.com domain is not verified.'}),{status:403});
r = await sendEmail({request:post({password:'admin-pw',code:'ADEBAYO01'}),env}); j = await r.json();
check('Resend 403 -> ok:false with its own message', r.status===502 && j.ok===false && /domain is not verified/.test(j.error), JSON.stringify(j));
resendReply=()=>new Response('<html>gateway down</html>',{status:500});
r = await sendEmail({request:post({password:'admin-pw',code:'ADEBAYO01'}),env}); j = await r.json();
check('non-JSON 500 from Resend still gives a clean error', r.status===502 && j.ok===false && /HTTP 500/.test(j.error), JSON.stringify(j));
resendReply=()=>{ throw new TypeError('network down'); };
r = await sendEmail({request:post({password:'admin-pw',code:'ADEBAYO01'}),env}); j = await r.json();
check('network failure -> 502, not a crash', r.status===502 && j.ok===false, JSON.stringify(j));
resendReply=()=>{ const e=new Error('aborted'); e.name='AbortError'; throw e; };
r = await sendEmail({request:post({password:'admin-pw',code:'ADEBAYO01'}),env}); j = await r.json();
check('timeout -> says so', /too long/.test(j.error), j.error);
resendReply=()=>new Response(JSON.stringify({id:'x'}),{status:200});

console.log('\n=== not configured ===');
check('503 without RESEND_API_KEY', (await sendEmail({request:post({password:'admin-pw',code:'ADEBAYO01'}),env:{...env,RESEND_API_KEY:undefined}})).status===503);
check('  and it names the missing variable', /RESEND_API_KEY/.test((await (await sendEmail({request:post({password:'admin-pw',code:'ADEBAYO01'}),env:{...env,RESEND_API_KEY:undefined}})).json()).error));
check('503 without KV', (await sendEmail({request:post({password:'admin-pw',code:'ADEBAYO01'}),env:{...env,REFERRALS_KV:undefined}})).status===503);

console.log('\n=== get-affiliates ===');
await new Promise(r=>setTimeout(r,5));
await registerAff({request:post({password:'admin-pw',code:'LAGOSDIST',name:'Lagos Dist',email:'l@example.com'}),env});
await KV.put('application:2026-01-01T00:00:00.000Z-aaaa', JSON.stringify({name:'App'}), {metadata:{s:'pending'}});
await KV.put('referral:ADEBAYO01:tx1', '{}', {metadata:{t:1}});
r = await getAffiliates({request:post({password:'admin-pw'}),env}); j = await r.json();
check('lists the 3 affiliates', j.count===3 && j.affiliates.length===3, JSON.stringify(j.affiliates.map(a=>a.code)));
check('does NOT leak applications or sales', !JSON.stringify(j).includes('App') && !JSON.stringify(j).includes('tx1'));
check('newest first', j.affiliates[0].code==='LAGOSDIST', j.affiliates[0].code);
check('each row has code/name/email/date', j.affiliates.every(a=>a.code&&a.name&&a.email&&a.approved_at));
check('wrong password -> 401', (await getAffiliates({request:post({password:'nope'}),env})).status===401);
check('503 without password env', (await getAffiliates({request:post({password:'x'}),env:{REFERRALS_KV:KV}})).status===503);
// record written with no metadata (older/other writer) still lists
await KV.put('affiliate:LEGACY1', JSON.stringify({name:'Old Timer',email:'old@example.com',approved_at:'2020-01-01T00:00:00.000Z'}));
j = await (await getAffiliates({request:post({password:'admin-pw'}),env})).json();
const leg = j.affiliates.find(a=>a.code==='LEGACY1');
check('metadata-less record falls back to reading the value', leg && leg.name==='Old Timer' && leg.email==='old@example.com', JSON.stringify(leg));
check('...and sorts last (oldest)', j.affiliates[j.affiliates.length-1].code==='LEGACY1');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
