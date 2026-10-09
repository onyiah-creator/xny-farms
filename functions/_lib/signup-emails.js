/**
 * Emails for self-service affiliate signup: the "confirm your email" message
 * and the short notice to the XNY Farms inbox.
 *
 * Button rule (same as every XNY email): WHITE text on a DARK fill. Gmail's dark
 * mode rewrites dark text on bright fills, so there is no dark lettering.
 * Lives in functions/_lib/ and exports no onRequest* handler.
 */
import { SITE_URL, esc, button, signatureRow } from "./email.js";
import { firstName } from "./payouts.js";

export const CONFIRM_SUBJECT = "Confirm your email to activate your XNY Farms affiliate account";

/** Pure. `verifyUrl` is the full link; `siteUrl` only points images at a preview server. */
export function buildConfirmationEmail({ name, verifyUrl, siteUrl, hours = 48 }) {
  const site = (siteUrl || SITE_URL).replace(/\/$/, "");
  const logo = `${site}/assets/email/logo-email.jpg`;
  const xIcon = `${site}/assets/email/x-icon-white.png`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${esc(CONFIRM_SUBJECT)}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    /* A backstop only: Gmail ignores much of this. */
    @media (prefers-color-scheme: dark) {
      a.btn-link .btn-text { color: #ffffff !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#faf6ee;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#faf6ee;">
    One tap to confirm your email and get your referral code.
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
              <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;color:#ffffff;">Confirm your email</h1>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#14231a;">
              <p style="margin:0 0 16px;">Hi ${esc(firstName(name))},</p>
              <p style="margin:0 0 16px;">Thanks for signing up to the XNY Farms affiliate programme. Confirm your email address and your account is activated straight away: you get your own referral code and link to share, and you start earning <strong>8% commission</strong> on every completed sale made through it.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:6px 32px 4px;">
              ${button({ href: verifyUrl, label: "Confirm My Email", background: "#06552a", border: "#06552a" })}
            </td>
          </tr>

          <tr>
            <td style="padding:14px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#3d4a42;">
              <p style="margin:0 0 12px;">This link works for ${hours} hours. After that your details are deleted automatically and you can simply sign up again.</p>
              <p style="margin:0;">If you didn&rsquo;t sign up, ignore this email: nothing will be created.</p>
            </td>
          </tr>

          ${signatureRow({ xIcon })}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${firstName(name)},`,
    "",
    "Thanks for signing up to the XNY Farms affiliate programme. Confirm your email address and your account is activated straight away: you get your own referral code and link to share, and you earn 8% commission on every completed sale made through it.",
    "",
    "Confirm your email:",
    verifyUrl,
    "",
    `This link works for ${hours} hours. After that your details are deleted automatically and you can simply sign up again.`,
    "If you didn't sign up, ignore this email: nothing will be created.",
    "",
    "Thank you for partnering with us.",
    "",
    "XNY Farms Limited",
    "xnyfarms@gmail.com | +234 806 013 8299",
    "41 Babaponmile Street, Onipetesi, Mangoro, Ikeja, Lagos, Nigeria",
    "Follow us on X: https://x.com/xnyfarms"
  ].join("\n");

  return { subject: CONFIRM_SUBJECT, html, text };
}

/** The short notice sent to the XNY Farms inbox when someone self-registers. Plain, no buttons. */
export function buildAdminNotice({ name, code, email }) {
  const subject = `New affiliate: ${String(name).slice(0, 80)} (${code})`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#14231a;">
<p style="margin:0 0 8px;"><strong>New affiliate (self-signup)</strong></p>
<p style="margin:0;">Name: ${esc(name)}<br>Code: <strong>${esc(code)}</strong><br>Email: ${esc(email)}</p>
<p style="margin:12px 0 0;color:#3d4a42;font-size:13px;">They confirmed their email and were activated automatically. Manage them under Approved affiliates in the admin area.</p>
</body></html>`;
  const text = `New affiliate (self-signup)\nName: ${name}\nCode: ${code}\nEmail: ${email}\n\nThey confirmed their email and were activated automatically.`;
  return { subject, html, text };
}
