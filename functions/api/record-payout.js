/**
 * POST /api/record-payout — Cloudflare Pages Function
 *
 * The admin's ledger of money actually SENT to affiliates. The site never
 * moves money itself: an admin pays an affiliate outside the site (bank
 * transfer, Flutterwave transfer, cash) and then records it here, so the
 * referral report can show earned, paid and still-owed per affiliate.
 * Gated by ADMIN_REPORT_PASSWORD, like every admin endpoint.
 *
 * Record a payment — body (JSON):
 *   password    string  ADMIN_REPORT_PASSWORD
 *   code        string  an APPROVED affiliate's referral code
 *   amount_ngn  number  positive, finite, at most MAX_PAYOUT_NGN
 *   paid_on     string  ISO date ("2026-10-09") or date-time
 *   reference   string  optional, e.g. a Flutterwave transfer or bank reference
 *   note        string  optional
 *   email_receipt  bool  optional (default false): email the affiliate a receipt
 *   -> { ok: true, recorded: true, notified, email_requested, key, code, amount_ngn, paid_on, error? }
 *   The payout is saved FIRST and stays saved whatever happens to the email. If the
 *   email fails the answer is still ok:true, recorded:true, notified:false, with
 *   error saying why. The recipient, totals and bank last-4 are read from KV; an
 *   "email" or "phone" in the request is ignored. See _lib/receipt.js.
 *
 * Resend a receipt for an existing payout — body (JSON):
 *   password, payout_key  (only keys starting "payout:" are accepted)
 *   -> { ok: true, notified: true } or { ok: false, notified: false, error }
 *
 * Remove a mistaken entry — body (JSON):
 *   password    string
 *   delete_key  string  the payout's key; only keys starting "payout:" are accepted
 *   -> { ok: true, deleted: key }
 *
 * Stored as  payout:{CODE}:{ISO timestamp}-{shortId}  with the full record as
 * the value and short KV metadata { c: code, a: amount, ts: paid_on }, so the
 * report and get-my-stats can total payouts from list() alone, no get() per
 * record.
 *
 * Overpayment is deliberately NOT rejected: paying ahead (an advance, a
 * rounded-up transfer) is a normal thing to do. The report flags it instead.
 */

import { sendPayoutReceipt } from "../_lib/receipt.js";

const CODE_PATTERN = /^[A-Za-z0-9]{3,32}$/;
const MAX_PAYOUT_NGN = 100000000;   // sanity ceiling, rejects absurd payloads
const MAX_REFERENCE = 80;
const MAX_NOTE = 300;
const EARLIEST_PAID_ON = "2020-01-01";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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

/** Trim, drop control characters, cap the length. */
function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function shortId() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns the normalised paid_on, or null if it isn't a sane date. A bare
 *  date is kept as written; a full timestamp is normalised to UTC ISO. The
 *  upper bound is a day ahead of now, to forgive timezones. */
function normalisePaidOn(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const parsed = new Date(DATE_ONLY.test(v) ? `${v}T00:00:00.000Z` : v);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() < new Date(`${EARLIEST_PAID_ON}T00:00:00.000Z`).getTime()) return null;
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  if (DATE_ONLY.test(v) && parsed.toISOString().slice(0, 10) !== v) return null;   // e.g. 2026-02-31
  return DATE_ONLY.test(v) ? v : parsed.toISOString();
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
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "Body must be a JSON object." }, 400);
  }

  const supplied = typeof body.password === "string" ? body.password : "";
  if (!timingSafeEqual(supplied, env.ADMIN_REPORT_PASSWORD)) {
    return json({ ok: false, error: "Incorrect password." }, 401);
  }

  if (body.delete_key !== undefined && body.payout_key !== undefined) {
    return json({ ok: false, error: "Send either delete_key or payout_key, not both." }, 400);
  }

  /* ---- Resend a receipt ----
     Same prefix guard as delete_key, for the same reason: the key comes from
     the browser. The recipient is whatever is on the affiliate record in KV. */
  if (body.payout_key !== undefined) {
    const key = typeof body.payout_key === "string" ? body.payout_key.trim() : "";
    if (!key.startsWith("payout:") || key.length > 200) {
      return json({ ok: false, error: "payout_key must be a payout key." }, 400);
    }
    const result = await sendPayoutReceipt(env, key);
    if (result.missing) return json({ ok: false, notified: false, error: result.error }, 404);
    if (!result.ok) return json({ ok: false, notified: false, error: result.error }, 502);
    return json({ ok: true, notified: true });
  }

  /* ---- Remove a mistaken entry ----
     The key comes from the browser, so it is held to the "payout:" prefix:
     without that, this would be a way to delete any key in the namespace —
     an affiliate, an application, a sale. */
  if (body.delete_key !== undefined) {
    const key = typeof body.delete_key === "string" ? body.delete_key.trim() : "";
    if (!key.startsWith("payout:") || key.length > 200) {
      return json({ ok: false, error: "delete_key must be a payout key." }, 400);
    }
    try {
      const existing = await env.REFERRALS_KV.get(key);
      if (existing === null) {
        return json({ ok: false, error: "No such payout record." }, 404);
      }
      await env.REFERRALS_KV.delete(key);
    } catch (err) {
      return json({ ok: false, error: "Could not delete the payout record." }, 500);
    }
    return json({ ok: true, deleted: key });
  }

  /* ---- Record a payment ---- */
  const rawCode = typeof body.code === "string" ? body.code.trim() : "";
  if (!CODE_PATTERN.test(rawCode)) {
    return json({ ok: false, error: "Invalid affiliate code." }, 400);
  }
  const code = rawCode.toUpperCase();

  const amount = typeof body.amount_ngn === "number" ? body.amount_ngn : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYOUT_NGN) {
    return json({
      ok: false,
      error: `amount_ngn must be a positive number no larger than ${MAX_PAYOUT_NGN}.`
    }, 400);
  }
  const amountNgn = Math.round(amount * 100) / 100;
  if (amountNgn <= 0) {
    return json({ ok: false, error: "amount_ngn is too small to record." }, 400);
  }

  const paidOn = normalisePaidOn(body.paid_on);
  if (!paidOn) {
    return json({
      ok: false,
      error: "paid_on must be a real date (YYYY-MM-DD), not in the future and not before 2020."
    }, 400);
  }

  const reference = clean(body.reference, MAX_REFERENCE);
  const note = clean(body.note, MAX_NOTE);

  // Only approved affiliates can be paid. Unknown codes are refused rather
  // than silently creating a ledger entry no report would ever attribute.
  let affiliate;
  try {
    affiliate = await env.REFERRALS_KV.get(`affiliate:${code}`);
  } catch (err) {
    return json({ ok: false, error: "Could not verify the affiliate." }, 500);
  }
  if (!affiliate) {
    return json({
      ok: false,
      error: `No approved affiliate has the code ${code}. Check the code and try again.`
    }, 404);
  }

  const recordedAt = new Date().toISOString();
  const key = `payout:${code}:${recordedAt}-${shortId()}`;
  const record = {
    code,
    amount_ngn: amountNgn,
    paid_on: paidOn,
    reference,
    note,
    recorded_at: recordedAt
  };

  try {
    await env.REFERRALS_KV.put(key, JSON.stringify(record), {
      // Short keys — KV caps metadata at 1024 bytes.
      metadata: { c: code, a: amountNgn, ts: paidOn }
    });
  } catch (err) {
    return json({ ok: false, error: "Could not save the payout record." }, 500);
  }

  // The payout is saved. Everything below is best effort and can only ever
  // change the answer's notified/error fields, never un-record the payment.
  const emailRequested = body.email_receipt === true;
  const answer = { ok: true, recorded: true, notified: false, email_requested: emailRequested, key, code, amount_ngn: amountNgn, paid_on: paidOn };
  if (emailRequested) {
    let result;
    try {
      result = await sendPayoutReceipt(env, key, { ensure: { key, amount: amountNgn } });
    } catch (err) {
      result = { ok: false, error: "Could not send the receipt email." };
    }
    answer.notified = result.ok === true;
    if (!result.ok) answer.error = result.error;
  }
  return json(answer);
}
