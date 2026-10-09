/**
 * Shared email building blocks, used by the affiliate welcome email
 * (api/send-affiliate-email.js) and the payout receipt (_lib/receipt.js).
 *
 * This file lives in functions/_lib/ and exports no onRequest* handler, so
 * Cloudflare Pages does not turn it into a route; it is only ever imported.
 */

export const FROM = "XNY Farms <affiliates@xnyfarms.com>";
// Replies go to the inbox that is actually monitored; affiliates@ is a
// sending identity and may not have a mailbox behind it.
export const REPLY_TO = "xnyfarms@gmail.com";
export const SITE_URL = "https://xnyfarms.com";
export const X_URL = "https://x.com/xnyfarms";
export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const RESEND_TIMEOUT_MS = 15000;

/** The affiliate's name originates from a public form, so it is untrusted
 *  text going into HTML. Escaping it here is what stops a crafted name like
 *  `<a href="…">` from becoming live markup in an email sent from your
 *  domain. */
export function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Button label rule: a label is EITHER white text on a dark fill, OR part of an image.
 * Never dark text on a bright fill. Gmail's dark mode (notably on Android)
 * rewrites dark text colours on its own, without regard for the button's
 * background; inline styles, !important, color-scheme meta tags and
 * prefers-color-scheme don't stop it. Dark text on yellow was tried (near-black
 * green, then brand green) and failed on a real device. White on a dark fill
 * gives it nothing to flip, and Gmail never alters images, so the yellow
 * "View My Referral Link" button carries its green lettering inside a PNG
 * (tools/generate-email-assets.mjs) with the real label as alt text.
 * Colours are also stated redundantly for clients that ignore one mechanism:
 * bgcolor + background-color on the cell, background on the link, and an
 * !important colour on both the link and a nested <span>.
 */
export const BUTTON_TEXT = "#ffffff";
export const BUTTON_FONT = "font-family:Arial,Helvetica,sans-serif;font-weight:700;line-height:1;";

/** `border` is a 2px (or 1px, for the small pill) ring. Buttons that want no
 *  visible ring pass their own fill colour, so every button ends up exactly the
 *  same size. `icon` is optional, already-escaped HTML placed before the label.
 *  `image` ({ src, width, height }) replaces the text label with a picture of
 *  it; `label` then becomes its alt text. */
export function button({ href, label, background, border, size = "large", icon = "", align = "center", image = null }) {
  const dims = size === "small"
    ? { pad: "8px 16px", font: "13px", ring: "1px" }
    : { pad: "13px 32px", font: "16px", ring: "2px" };
  const textStyle = `color:${BUTTON_TEXT} !important;`;
  // centred for the stacked call-to-action buttons, left for the signature pill
  const margin = align === "left" ? "margin:0;" : "margin:0 auto 14px;";
  const link = image
    ? `<a href="${href}" target="_blank" rel="noopener" class="btn-link"
             style="display:block;font-size:0;line-height:0;text-decoration:none;border-radius:999px;"><img class="btn-img" src="${image.src}" width="${image.width}" height="${image.height}" alt="${label}" style="display:block;border:0;width:${image.width}px;height:${image.height}px;border-radius:999px;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:16px;line-height:${image.height}px;color:#06552a;text-align:center;"></a>`
    : `<a href="${href}" target="_blank" rel="noopener" class="btn-link"
             style="display:inline-block;padding:${dims.pad};${BUTTON_FONT}font-size:${dims.font};${textStyle}text-decoration:none;border-radius:999px;background-color:${background};"><span class="btn-text" style="${textStyle}">${icon}${label}</span></a>`;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="${margin}">
      <tr>
        <td align="center" bgcolor="${background}" class="btn-cell" style="border:${dims.ring} solid ${border};border-radius:999px;background-color:${background};">
          ${link}
        </td>
      </tr>
    </table>`;
}

/** The shared sign-off: thanks, contact details and the "Follow us on X" pill. Returns a
 *  table row for the 600px card. */
export function signatureRow({ xIcon }) {
  return `<tr>
            <td style="padding:26px 32px 30px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e3dbc9;">
                <tr>
                  <td style="padding-top:22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#14231a;">
                    <p style="margin:0 0 4px;">Thank you for partnering with us.</p>
                    <p style="margin:0 0 14px;"><strong>XNY Farms Limited</strong><br>
                      xnyfarms@gmail.com &nbsp;|&nbsp; +234 806 013 8299<br>
                      41 Babaponmile Street, Onipetesi, Mangoro, Ikeja, Lagos, Nigeria</p>
                    ${button({
                      href: X_URL,
                      label: "Follow us on X",
                      background: "#14231a",
                      border: "#14231a",
                      size: "small",
                      align: "left",
                      icon: `<img src="${xIcon}" width="14" height="14" alt="" style="border:0;vertical-align:middle;margin-right:6px;">`
                    })}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

/** Sends one email through Resend. Never throws: returns { ok: true, id } or
 *  { ok: false, error, status? }. The API key is only ever used here and is
 *  never part of what is returned. */
export async function sendViaResend(env, { to, subject, html, text }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html, text }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    const timedOut = err && err.name === "AbortError";
    return {
      ok: false,
      error: timedOut
        ? "The email service took too long to respond. Try again in a moment."
        : "Could not reach the email service."
    };
  }
  clearTimeout(timer);

  let payload = {};
  try {
    payload = await response.json();
  } catch (err) { /* a non-JSON body is handled below */ }

  if (!response.ok) {
    // Resend's errors are specific and actionable (unverified domain, bad
    // key, invalid recipient…), so its own message is passed straight back.
    const detail = (payload && (payload.message || payload.error)) || `HTTP ${response.status}`;
    return { ok: false, error: `Resend rejected the email: ${detail}`, status: response.status };
  }
  return { ok: true, id: payload.id || null };
}
