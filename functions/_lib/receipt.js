/**
 * Payment receipt emails: what an affiliate is sent when the admin records a
 * payout, and what "Resend receipt" sends again.
 *
 * Everything in the email is read from KV on the server — the recipient (the
 * email on the affiliate record), the totals, the bank name and last four
 * digits. Nothing comes from the request, so the endpoint can't be pointed at
 * another address and the totals can't be faked. The FULL account number is
 * never part of a receipt.
 *
 * Button rule (same as the welcome email): white text on a dark fill. Gmail's
 * dark mode rewrites dark text on bright fills, so there is no dark lettering.
 *
 * Lives in functions/_lib/ and exports no onRequest* handler, so Pages does
 * not make it a route.
 */
import { SITE_URL, esc, button, signatureRow, sendViaResend } from "./email.js";
import {
  getJson, loadAffiliate, standingFor, resolvePayoutDetails,
  last4, firstName, formatNgn, formatDate
} from "./payouts.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pure. `siteUrl` exists so a preview can point images at a local server. */
export function buildReceiptEmail({ name, code, amount, paidOn, reference, note, bankName, last4: tail, earned, paidToDate, balanceDue, siteUrl }) {
  const site = (siteUrl || SITE_URL).replace(/\/$/, "");
  const statsLink = `${site}/my-stats.html?code=${encodeURIComponent(code)}`;
  const logo = `${site}/assets/email/logo-email.jpg`;
  const xIcon = `${site}/assets/email/x-icon-white.png`;
  const subject = `Your XNY Farms commission payment of ${formatNgn(amount)}`;
  const date = formatDate(paidOn);
  const destination = bankName
    ? `${bankName} account${tail ? ` ending ${tail}` : ""}`
    : tail ? `bank account ending ${tail}` : "";

  const detailRows = [
    ["Amount paid", `<strong>${esc(formatNgn(amount))}</strong>`],
    ["Date", esc(date)],
    destination ? ["Paid to", esc(destination)] : null,
    reference ? ["Reference", esc(reference)] : null,
    note ? ["Note", esc(note)] : null
  ].filter(Boolean);
  const totalRows = [
    ["Total commission earned", esc(formatNgn(earned))],
    ["Total paid to date (including this payment)", esc(formatNgn(paidToDate))],
    ["Balance still due", `<strong>${esc(formatNgn(balanceDue))}</strong>`]
  ];
  const rowHtml = (rows) => rows.map(([label, value]) => `
                <tr>
                  <td style="padding:6px 12px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#3d4a42;vertical-align:top;">${label}</td>
                  <td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#14231a;vertical-align:top;">${value}</td>
                </tr>`).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${esc(subject)}</title>
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
    We have paid ${esc(formatNgn(amount))} commission to you. Balance still due: ${esc(formatNgn(balanceDue))}.
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
              <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;color:#ffffff;">Commission payment sent</h1>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#14231a;">
              <p style="margin:0 0 16px;">Hi ${esc(firstName(name))},</p>
              <p style="margin:0 0 16px;">We have paid your affiliate commission. Here are the details.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e3dbc9;border-bottom:1px solid #e3dbc9;">${rowHtml(detailRows)}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 8px;">
              <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#3d4a42;">Where you stand</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #e3dbc9;">${rowHtml(totalRows)}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 32px 4px;">
              ${button({ href: statsLink, label: "View My Earnings", background: "#0b4124", border: "#0b4124" })}
            </td>
          </tr>

          <tr>
            <td style="padding:14px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#3d4a42;">
              <p style="margin:0;">If anything here looks wrong, just reply to this email or write to <a href="mailto:xnyfarms@gmail.com" style="color:#06552a;">xnyfarms@gmail.com</a> and we will sort it out.</p>
            </td>
          </tr>

          ${signatureRow({ xIcon })}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const lines = [
    `Hi ${firstName(name)},`,
    "",
    "We have paid your affiliate commission. Here are the details.",
    "",
    `Amount paid: ${formatNgn(amount)}`,
    `Date: ${date}`,
    destination ? `Paid to: ${destination}` : null,
    reference ? `Reference: ${reference}` : null,
    note ? `Note: ${note}` : null,
    "",
    "Where you stand:",
    `Total commission earned: ${formatNgn(earned)}`,
    `Total paid to date (including this payment): ${formatNgn(paidToDate)}`,
    `Balance still due: ${formatNgn(balanceDue)}`,
    "",
    "View your earnings:",
    statsLink,
    "",
    "If anything here looks wrong, reply to this email or write to xnyfarms@gmail.com and we will sort it out.",
    "",
    "Thank you for partnering with us.",
    "",
    "XNY Farms Limited",
    "xnyfarms@gmail.com | +234 806 013 8299",
    "41 Babaponmile Street, Onipetesi, Mangoro, Ikeja, Lagos, Nigeria",
    "Follow us on X: https://x.com/xnyfarms"
  ].filter((line) => line !== null);

  return { subject, html, text: lines.join("\n"), statsLink };
}

/**
 * Sends the receipt for an existing payout and records the outcome on the
 * payout record (value.notified_email = { at, ok, error }; the KV metadata is
 * re-written unchanged, so it stays { c, a, ts }).
 *
 * Never throws. Returns { ok: true, to } or { ok: false, error }. The payout
 * itself is never touched beyond that one field, and a failure here can never
 * un-record it.
 *   ensure — { key, amount } of a payout written a moment ago (see standingFor)
 */
export async function sendPayoutReceipt(env, payoutKey, { ensure } = {}) {
  const kv = env.REFERRALS_KV;
  let record;
  try {
    record = await getJson(kv, payoutKey);
  } catch (err) {
    return { ok: false, error: "Could not read the payout record." };
  }
  if (!record) return { ok: false, error: "No such payout record.", missing: true };
  // The same short metadata record-payout.js writes; put() replaces metadata, so it is restated.
  const metadata = { c: record.code, a: record.amount_ngn, ts: record.paid_on };

  let result;
  try {
    result = await deliver(env, record, payoutKey, ensure);
  } catch (err) {
    result = { ok: false, error: "Could not build or send the receipt." };
  }

  // Record the outcome on the payout. Best effort: if this write fails the
  // receipt has still been sent (or not), and the report just shows "Not emailed".
  try {
    record.notified_email = {
      at: new Date().toISOString(),
      ok: result.ok,
      error: result.ok ? "" : String(result.error || "").slice(0, 300)
    };
    await kv.put(payoutKey, JSON.stringify(record), { metadata });
  } catch (err) { /* see above */ }

  return result;
}

async function deliver(env, record, payoutKey, ensure) {
  if (!env.RESEND_API_KEY) {
    return {
      ok: false,
      error: "RESEND_API_KEY is not set. Add it to this Pages project under Settings → Environment variables, then redeploy."
    };
  }
  const kv = env.REFERRALS_KV;
  const code = String(record.code || "").toUpperCase();
  const affiliate = await loadAffiliate(kv, code);
  if (!affiliate) return { ok: false, error: `No affiliate record for ${code}, so there is no email address on file.` };
  const email = affiliate.email.trim();
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: `The email on file for ${code} isn't valid.` };

  const [standing, details] = await Promise.all([
    standingFor(kv, code, ensure),
    resolvePayoutDetails(kv, [affiliate])
  ]);
  const payout = (details.get(code) || {}).payout || null;

  const message = buildReceiptEmail({
    name: affiliate.name,
    code,
    amount: record.amount_ngn,
    paidOn: record.paid_on,
    reference: record.reference,
    note: record.note,
    bankName: payout ? payout.bank_name : "",
    last4: payout ? last4(payout.account_number) : "",
    earned: standing.earned_ngn,
    paidToDate: standing.paid_ngn,
    balanceDue: standing.balance_due_ngn
  });

  const sent = await sendViaResend(env, { to: email, subject: message.subject, html: message.html, text: message.text });
  return sent.ok ? { ok: true, to: email, id: sent.id } : { ok: false, error: sent.error };
}
