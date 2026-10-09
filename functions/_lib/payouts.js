/**
 * KV readers and payout maths shared by get-referrals.js (the admin report),
 * record-payout.js (payments and receipts) and get-my-stats.js.
 *
 * This file lives in functions/_lib/ and exports no onRequest* handler, so
 * Cloudflare Pages does not turn it into a route; it is only ever imported.
 *
 * Key schemes:
 *   affiliate:{CODE}            approved affiliate; metadata {n,e,at,k}
 *   referral:{CODE}:{tx_ref}    a sale; metadata {c,t,m,ts}
 *   payout:{CODE}:{ts}-{id}     a payment to an affiliate; metadata {c,a,ts}
 *   application:{ts}-{id}       signup application (bank details, phone)
 */

export const COMMISSION_RATE = 0.08;
export const REFERRAL_PREFIX = "referral:";
export const PAYOUT_PREFIX = "payout:";
export const AFFILIATE_PREFIX = "affiliate:";
export const APPLICATION_PREFIX = "application:";
export const MAX_FALLBACK_SCAN = 500;   // newest applications read when matching by email
export const BATCH = 20;                // concurrent get() calls

/* ---- money, in kobo ---- */
export const toKobo = (n) => Math.round(Number(n) * 100);
export const fromKobo = (k) => k / 100;

/** earned/paid in kobo -> the figures a row shows. Balance never goes negative. */
export function figures(earnedKobo, paidKobo) {
  const diff = earnedKobo - paidKobo;
  return {
    commission_ngn: fromKobo(earnedKobo),
    commission_earned_ngn: fromKobo(earnedKobo),
    paid_ngn: fromKobo(paidKobo),
    balance_due_ngn: fromKobo(Math.max(0, diff)),
    overpaid: diff < 0,
    overpaid_ngn: fromKobo(Math.max(0, -diff))
  };
}

/* ---- KV helpers ---- */
export async function listAll(kv, prefix) {
  const keys = [];
  let cursor;
  let complete = false;
  while (!complete) {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    for (const key of page.keys) keys.push(key);
    cursor = page.cursor;
    complete = page.list_complete === true || !page.cursor;
  }
  return keys;
}

/** Runs fn over items BATCH at a time, preserving order. */
export async function mapBatched(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += BATCH) {
    out.push(...(await Promise.all(items.slice(i, i + BATCH).map(fn))));
  }
  return out;
}

export async function getJson(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch (err) {
    return null;
  }
}

/** Orders under a prefix as [{ code, tx_ref, timestamp, total, commission }].
 *  Everything comes from metadata (the tx_ref is in the key), so this costs
 *  one list() per 1000 records; a record without metadata is read instead. */
export async function loadOrders(kv, prefix) {
  const keys = await listAll(kv, prefix);
  const orders = [];
  for (const key of keys) {
    const meta = key.metadata;
    const parts = key.name.split(":");           // referral:{code}:{tx_ref, which may contain ":"}
    let code = parts[1];
    let txRef = parts.slice(2).join(":");
    let total;
    let commission;
    let timestamp;

    if (meta && typeof meta.t === "number") {
      code = meta.c || code;
      total = meta.t;
      commission = typeof meta.m === "number" ? meta.m : meta.t * COMMISSION_RATE;
      timestamp = meta.ts;
    } else {
      const value = await getJson(kv, key.name);
      if (!value) continue;
      code = value.ref_code || code;
      txRef = value.tx_ref || txRef;
      total = Number(value.order_total_ngn);
      commission = Number(value.commission_ngn);
      timestamp = value.timestamp;
    }

    if (!code) code = "(unknown)";
    if (!Number.isFinite(total)) continue;
    if (!Number.isFinite(commission)) commission = total * COMMISSION_RATE;
    orders.push({
      code: String(code).toUpperCase(),
      tx_ref: txRef,
      timestamp: timestamp || null,
      total,
      commission
    });
  }
  return orders;
}

/** Payouts under a prefix as [{ key, code, amount, paid_on }] from metadata
 *  alone; a record without usable metadata is read instead. */
export async function loadPayoutTotals(kv, prefix) {
  const keys = await listAll(kv, prefix);
  const payouts = [];
  for (const key of keys) {
    const meta = key.metadata;
    let code = key.name.split(":")[1];
    let amount;
    if (meta && typeof meta.a === "number") {
      code = meta.c || code;
      amount = meta.a;
    } else {
      const value = await getJson(kv, key.name);
      if (!value) continue;
      code = value.code || code;
      amount = Number(value.amount_ngn);
    }
    if (!Number.isFinite(amount) || amount <= 0) continue;
    payouts.push({ key: key.name, code: String(code).toUpperCase(), amount });
  }
  return payouts;
}

/** Approved affiliates: [{ code, name, email, approved_at, application_key }]. */
export async function loadAffiliates(kv) {
  const keys = await listAll(kv, AFFILIATE_PREFIX);
  return mapBatched(keys, async (key) => {
    const code = key.name.slice(AFFILIATE_PREFIX.length).toUpperCase();
    const meta = key.metadata;
    if (meta && typeof meta.n === "string") {
      return { code, name: meta.n, email: meta.e || "", approved_at: meta.at || null, application_key: meta.k || "" };
    }
    const value = (await getJson(kv, key.name)) || {};
    return {
      code,
      name: String(value.name || ""),
      email: String(value.email || ""),
      approved_at: value.approved_at || null,
      application_key: typeof value.application_key === "string" ? value.application_key : ""
    };
  });
}

/** The payout-relevant part of an application, or null. */
export function fromApplication(app) {
  if (!app) return { phone: "", payout: null };
  const payout = {
    bank_name: String(app.bank_name || ""),
    account_number: String(app.account_number || ""),
    account_holder: String(app.account_holder || "")
  };
  const hasBank = payout.bank_name || payout.account_number || payout.account_holder;
  return { phone: String(app.phone || ""), payout: hasBank ? payout : null };
}

/**
 * Finds each affiliate's application: by application_key, else by the most
 * recent application with the same email. Returns Map(code -> { phone, payout }).
 */
export async function resolvePayoutDetails(kv, affiliates) {
  const result = new Map();
  const needEmailMatch = [];

  const linked = await mapBatched(affiliates, async (aff) => {
    if (!aff.application_key || !aff.application_key.startsWith(APPLICATION_PREFIX)) return null;
    return getJson(kv, aff.application_key);
  });
  affiliates.forEach((aff, i) => {
    if (linked[i]) result.set(aff.code, fromApplication(linked[i]));
    else needEmailMatch.push(aff);
  });

  if (needEmailMatch.length) {
    const wanted = new Set(needEmailMatch.map((a) => a.email.toLowerCase()).filter(Boolean));
    const found = new Map();                                    // email -> application (newest first wins)
    if (wanted.size) {
      const keys = (await listAll(kv, APPLICATION_PREFIX)).map((k) => k.name);
      keys.sort().reverse();                                    // keys lead with an ISO timestamp
      const candidates = keys.slice(0, MAX_FALLBACK_SCAN);
      for (let i = 0; i < candidates.length && found.size < wanted.size; i += BATCH) {
        const apps = await Promise.all(candidates.slice(i, i + BATCH).map((k) => getJson(kv, k)));
        for (const app of apps) {                               // still newest-first within the batch
          const email = app && typeof app.email === "string" ? app.email.trim().toLowerCase() : "";
          if (email && wanted.has(email) && !found.has(email)) found.set(email, app);
        }
      }
    }
    for (const aff of needEmailMatch) {
      result.set(aff.code, fromApplication(found.get(aff.email.toLowerCase()) || null));
    }
  }
  return result;
}


/* ================= receipts, messages and phone numbers ================= */

/**
 * Nigerian mobile number -> international digits without "+", or null.
 *   strips spaces, dashes, dots, brackets and a leading "+" (or "00");
 *   0XXXXXXXXXX  (11 digits) -> 234XXXXXXXXXX
 *   234XXXXXXXXXX (13 digits) stays
 *   anything else is invalid.
 */
export function normalisePhone(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[\s\-().]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  if (!/^\d+$/.test(s)) return null;
  if (s.length === 11 && s.startsWith("0")) return "234" + s.slice(1);
  if (s.length === 13 && s.startsWith("234")) return s;
  return null;
}

/** Last four digits of an account number; "" if there are fewer than four. */
export function last4(account) {
  const digits = String(account || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

export function firstName(name) {
  const first = String(name || "").trim().split(/\s+/)[0];
  return first || "there";
}

/** ₦1,500 or ₦1,500.50. Hand-rolled so it never depends on the runtime's locale data. */
export function formatNgn(amount) {
  const n = Math.round(Number(amount) * 100) / 100;
  const [whole, frac] = Math.abs(n).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-" : "") + "₦" + grouped + (frac === "00" ? "" : "." + frac);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-05-10" or a full ISO timestamp -> "10 May 2026" (UTC, so it never shifts a day). */
export function formatDate(value) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Reads one approved affiliate, or null. */
export async function loadAffiliate(kv, code) {
  const value = await getJson(kv, `${AFFILIATE_PREFIX}${code}`);
  if (!value) return null;
  return {
    code,
    name: String(value.name || ""),
    email: String(value.email || ""),
    approved_at: value.approved_at || null,
    application_key: typeof value.application_key === "string" ? value.application_key : ""
  };
}

/**
 * Where an affiliate stands right now, computed from KV (never from a request):
 * { earned_ngn, paid_ngn, balance_due_ngn, overpaid }.
 * `ensure` ({ key, amount }) is a payout that was JUST written: KV is eventually
 * consistent, so if list() doesn't show it yet it is added here, otherwise a
 * receipt could report a total that leaves out the very payment it is for.
 */
export async function standingFor(kv, code, ensure) {
  const [orders, payouts] = await Promise.all([
    loadOrders(kv, `${REFERRAL_PREFIX}${code}:`),
    loadPayoutTotals(kv, `${PAYOUT_PREFIX}${code}:`)
  ]);
  let paidK = payouts.reduce((acc, p) => acc + toKobo(p.amount), 0);
  if (ensure && !payouts.some((p) => p.key === ensure.key)) paidK += toKobo(ensure.amount);
  const earnedK = orders.reduce((acc, o) => acc + toKobo(o.commission), 0);
  const f = figures(earnedK, paidK);
  return {
    earned_ngn: f.commission_earned_ngn,
    paid_ngn: f.paid_ngn,
    balance_due_ngn: f.balance_due_ngn,
    overpaid: f.overpaid
  };
}

/**
 * Plain-text message for WhatsApp / SMS, built server-side so the browser never
 * recomputes totals. Contains the bank name and LAST FOUR digits only.
 */
export function buildReceiptMessage({ name, amount, bankName, last4: tail, paidOn, reference, paidToDate, balanceDue, statsLink }) {
  const where = bankName
    ? `your ${bankName} account${tail ? ` ending ${tail}` : ""}`
    : tail ? `your bank account ending ${tail}` : "your bank account";
  const date = formatDate(paidOn);
  const parts = [
    `Hello ${firstName(name)}, XNY Farms has paid ${formatNgn(amount)} commission to ${where}${date ? ` on ${date}` : ""}.`
  ];
  if (reference) parts.push(`Ref: ${reference}.`);
  parts.push(`Total paid to date: ${formatNgn(paidToDate)}.`);
  parts.push(`Balance due: ${formatNgn(balanceDue)}.`);
  // No full stop after the link: chat apps would treat it as part of the URL
  // (the code is the last thing in it) and send the affiliate to a broken page.
  parts.push(`Check your earnings: ${statsLink}`);
  parts.push("Thank you for partnering with us.");
  return parts.join(" ");
}
