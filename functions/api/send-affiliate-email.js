/**
 * POST /api/send-affiliate-email — Cloudflare Pages Function
 *
 * Sends an approved affiliate their welcome email through Resend
 * (https://resend.com). Used by admin-approve-affiliate.html, both straight
 * after approving someone and from the "Resend Welcome Email" button next to
 * an existing affiliate.
 *
 * Request body (JSON): { "password": "…", "code": "ADEBAYO01" }
 * Response: { ok: true, sent_to, id }  or  { ok: false, error }
 *
 * ── Why this takes only { password, code } ──
 * The brief allowed for name/email/links in the request, but accepting them
 * from the browser would let anyone holding the admin password point this at
 * an arbitrary recipient with arbitrary links, from the verified
 * affiliates@xnyfarms.com address. Instead the server looks the affiliate up
 * in KV and uses what is on file:
 *   - the recipient can only ever be the email stored at approval;
 *   - the links are built here from the code, always on the real domain;
 *   - the email can't announce an approval that doesn't exist, because a
 *     code with no affiliate:{CODE} record is refused.
 * That lookup is also how "resend" works with no extra data.
 *
 * ── Secrets / configuration ──
 *   RESEND_API_KEY        Pages environment variable (a secret). Never put it
 *                         in this repo or any client-side code.
 *   ADMIN_REPORT_PASSWORD Same password as the other admin endpoints. This
 *                         endpoint MUST stay gated: it sends mail from your
 *                         verified domain, so an open one would be a spam
 *                         relay and would burn the domain's sender reputation.
 *   REFERRALS_KV          The existing KV binding.
 *
 * Eventual consistency: KV can take a short while to propagate a fresh write
 * between locations. If this is called the instant after approval and the
 * record isn't visible yet, it answers 404 with a "try again in a moment"
 * message rather than guessing — the admin page offers a retry.
 */

const FROM = "XNY Farms <affiliates@xnyfarms.com>";
// Replies go to the inbox that is actually monitored; affiliates@ is a
// sending identity and may not have a mailbox behind it.
const REPLY_TO = "xnyfarms@gmail.com";
const SUBJECT = "Welcome to the XNY Farms Affiliate Program!";
const SITE_URL = "https://xnyfarms.com";
const X_URL = "https://x.com/xnyfarms";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 15000;

const CODE_PATTERN = /^[A-Za-z0-9]{3,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

/** The affiliate's name originates from a public form, so it is untrusted
 *  text going into HTML. Escaping it here is what stops a crafted name like
 *  `<a href="…">` from becoming live markup in an email sent from your
 *  domain. */
function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A "bulletproof" button: the colour is set on the table cell as well as on
 *  the link, because some clients (notably Outlook) ignore padding and
 *  background on <a>. The fallback is still a coloured, clickable cell. */
function button(href, label, background, color) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 14px;">
      <tr>
        <td align="center" bgcolor="${background}" style="border-radius:999px;background-color:${background};">
          <a href="${href}" target="_blank" rel="noopener"
             style="display:inline-block;padding:15px 34px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:1;color:${color};text-decoration:none;border-radius:999px;background-color:${background};">${label}</a>
        </td>
      </tr>
    </table>`;
}

/**
 * Builds the welcome email. Pure (no I/O) and exported so it can be tested and
 * previewed without sending anything. `siteUrl` is a parameter only so a
 * preview can point images at a local server; the live call uses SITE_URL.
 */
export function buildWelcomeEmail({ name, code, siteUrl }) {
  const site = (siteUrl || SITE_URL).replace(/\/$/, "");
  const safeName = esc(name || "there");
  const referralLink = `${site}/?ref=${encodeURIComponent(code)}`;
  const statsLink = `${site}/my-stats.html?code=${encodeURIComponent(code)}`;
  const logo = `${site}/assets/email/logo-email.jpg`;
  const xIcon = `${site}/assets/email/x-icon.png`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${esc(SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:#faf6ee;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#faf6ee;">
    Your referral code ${esc(code)} is ready &mdash; earn 8% commission on every completed sale.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf6ee;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e3dbc9;border-radius:12px;">

          <tr>
            <td align="center" style="padding:24px 28px 16px;background-color:#ffffff;border-radius:12px 12px 0 0;">
              <img src="${logo}" width="190" alt="XNY Farms" style="display:block;border:0;height:auto;max-width:100%;">
            </td>
          </tr>
          <tr>
            <td align="center" bgcolor="#06552a" style="background-color:#06552a;padding:20px 28px;">
              <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;color:#ffffff;">Welcome to the affiliate programme</h1>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#14231a;">
              <p style="margin:0 0 16px;">Hi ${safeName},</p>
              <p style="margin:0 0 20px;">Welcome to the XNY Farms affiliate programme &mdash; your account is approved and ready to use.</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:0 32px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                <tr>
                  <td align="center" bgcolor="#e7f3d9" style="background-color:#e7f3d9;border:1px solid #8cc10f;border-radius:10px;padding:14px 30px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#3d4a42;">Your referral code</div>
                    <div style="font-family:'Courier New',Courier,monospace;font-size:28px;font-weight:700;letter-spacing:2px;color:#043d1e;padding-top:4px;">${esc(code)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 4px;">
              ${button(referralLink, "View My Referral Link", "#dad905", "#043d1e")}
              ${button(statsLink, "Check My Earnings", "#06552a", "#ffffff")}
            </td>
          </tr>

          <tr>
            <td style="padding:18px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#14231a;">
              <p style="margin:0 0 16px;">Share your link anywhere &mdash; WhatsApp, Instagram, or in person. Anyone who opens it and buys from us is credited to you automatically. You can also use the <strong>Share</strong> button on any product page while your link is active, and it will include your code for you.</p>
              <p style="margin:0 0 16px;">You earn <strong>8% commission</strong> on every completed sale made through your link, calculated on the order subtotal (before delivery).</p>
              <p style="margin:0;font-size:14px;color:#3d4a42;">Commission is confirmed and paid after XNY Farms verifies each order.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 32px 30px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e3dbc9;">
                <tr>
                  <td style="padding-top:22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#14231a;">
                    <p style="margin:0 0 4px;">Thank you for partnering with us.</p>
                    <p style="margin:0 0 14px;"><strong>XNY Farms Limited</strong><br>
                      xnyfarms@gmail.com &nbsp;|&nbsp; +234 806 013 8299<br>
                      41 Babaponmile Street, Onipetesi, Mangoro, Ikeja, Lagos, Nigeria</p>
                    <a href="${X_URL}" target="_blank" rel="noopener"
                       style="display:inline-block;padding:8px 16px;border:1px solid #d9d4c4;border-radius:999px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:1;color:#14231a;text-decoration:none;background-color:#ffffff;">
                      <img src="${xIcon}" width="14" height="14" alt="" style="border:0;vertical-align:middle;margin-right:6px;">Follow us on X
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Plain-text alternative. Sending one alongside the HTML is part of
  // looking like legitimate mail to spam filters, and it's what shows in
  // clients that don't render HTML.
  const text = [
    `Hi ${name || "there"},`,
    "",
    "Welcome to the XNY Farms affiliate programme — your account is approved and ready to use.",
    "",
    `Your referral code: ${code}`,
    "",
    "Your personal referral link:",
    referralLink,
    "",
    "Check your earnings any time:",
    statsLink,
    "",
    "Share your link anywhere — WhatsApp, Instagram, or in person. Anyone who opens it and buys from us is credited to you automatically. You can also use the Share button on any product page while your link is active, and it will include your code for you.",
    "",
    "You earn 8% commission on every completed sale made through your link, calculated on the order subtotal (before delivery).",
    "",
    "Commission is confirmed and paid after XNY Farms verifies each order.",
    "",
    "Thank you for partnering with us.",
    "",
    "XNY Farms Limited",
    "xnyfarms@gmail.com | +234 806 013 8299",
    "41 Babaponmile Street, Onipetesi, Mangoro, Ikeja, Lagos, Nigeria",
    `Follow us on X: ${X_URL}`
  ].join("\n");

  return { subject: SUBJECT, html, text, referralLink, statsLink };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ADMIN_REPORT_PASSWORD) {
    return json({
      ok: false,
      error:
        "ADMIN_REPORT_PASSWORD is not set. Add it to this Pages project under " +
        "Settings → Environment variables, then redeploy."
    }, 503);
  }
  if (!env.RESEND_API_KEY) {
    return json({
      ok: false,
      error:
        "RESEND_API_KEY is not set. Add it to this Pages project under " +
        "Settings → Environment variables, then redeploy."
    }, 503);
  }
  if (!env.REFERRALS_KV) {
    return json({
      ok: false,
      error:
        "REFERRALS_KV is not bound. Create a KV namespace named REFERRALS_KV and bind it " +
        "to this Pages project under Settings → Functions → KV namespace bindings."
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: "Body must be valid JSON." }, 400);
  }

  const supplied = typeof body.password === "string" ? body.password : "";
  if (!timingSafeEqual(supplied, env.ADMIN_REPORT_PASSWORD)) {
    return json({ ok: false, error: "Incorrect password." }, 401);
  }

  const rawCode = typeof body.code === "string" ? body.code.trim() : "";
  if (!CODE_PATTERN.test(rawCode)) {
    return json({ ok: false, error: "Invalid referral code." }, 400);
  }
  const code = rawCode.toUpperCase();

  let record;
  try {
    const raw = await env.REFERRALS_KV.get(`affiliate:${code}`);
    record = raw ? JSON.parse(raw) : null;
  } catch (err) {
    return json({ ok: false, error: "Could not look up that affiliate." }, 500);
  }
  if (!record) {
    return json({
      ok: false,
      error:
        `No approved affiliate found for code ${code}. If you approved them a moment ago, ` +
        "wait a few seconds and try again."
    }, 404);
  }

  const email = typeof record.email === "string" ? record.email.trim() : "";
  if (!EMAIL_PATTERN.test(email)) {
    return json({ ok: false, error: `The email on file for ${code} isn't valid.` }, 422);
  }

  const message = buildWelcomeEmail({ name: record.name, code });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  let resendResponse;
  try {
    resendResponse = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        reply_to: REPLY_TO,
        subject: message.subject,
        html: message.html,
        text: message.text
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    const timedOut = err && err.name === "AbortError";
    return json({
      ok: false,
      error: timedOut
        ? "The email service took too long to respond. Try again in a moment."
        : "Could not reach the email service."
    }, 502);
  }
  clearTimeout(timer);

  let payload = {};
  try {
    payload = await resendResponse.json();
  } catch (err) { /* a non-JSON body is handled below */ }

  if (!resendResponse.ok) {
    // Resend's errors are specific and actionable (unverified domain, bad
    // key, invalid recipient…), so pass its own message straight back for the
    // admin page to show. The API key is never part of any response.
    const detail = (payload && (payload.message || payload.error)) || `HTTP ${resendResponse.status}`;
    return json({
      ok: false,
      error: `Resend rejected the email: ${detail}`,
      resend_status: resendResponse.status
    }, 502);
  }

  return json({ ok: true, sent_to: email, id: payload.id || null });
}
