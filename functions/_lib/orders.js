/**
 * Server-authoritative orders.
 *
 * The browser never decides what an order costs or whether it was paid:
 *   1. createOrder  prices the cart on the server from the pricing config in force, stores
 *      order:{tx_ref} (status "pending"), and returns the tx_ref and amount to charge.
 *   2. The customer pays in Flutterwave's window, using that tx_ref and amount.
 *   3. settleOrder  asks FLUTTERWAVE (server to server, with the secret key) whether that
 *      tx_ref was paid, in NGN, for at least the order total. Only then is the order marked
 *      "paid", commission credited, and the business notified. It is triggered by the browser
 *      after the payment window closes AND by Flutterwave's webhook, so an order is still
 *      confirmed if the customer closes the tab.
 *
 * A customer who edits the amount in their browser can still change what Flutterwave's window
 * charges, but the order will then be "underpaid": it is never marked paid, never credited to
 * an affiliate, and the business gets an alert instead of an order notification.
 *
 * Environment:
 *   FLW_SECRET_KEY   Flutterwave SECRET key (server only; never in the repo or the browser)
 *   FLW_SECRET_HASH  the "secret hash" set for the webhook in the Flutterwave dashboard
 *
 * order:{tx_ref} value: { tx_ref, status, created_at, items: [{id, qty, price_ngn}], subtotal_ngn,
 *   delivery_ngn, total_ngn, fulfilment, pricing_version, commission_rate, ref_code, customer,
 *   paid_at?, flw?, referral?, notified? }.  A pending order expires after 7 days; once it is
 *   paid (or flagged) it is rewritten without a TTL.
 *
 * Lives in functions/_lib/ and exports no onRequest* handler, so Pages does not route it.
 */
import math from "../../js/pricing-math.js";
import { getJson } from "./payouts.js";
import { loadCurrent } from "./pricing.js";
import { recordReferralForOrder } from "./referrals.js";
import { sendViaResend, REPLY_TO, esc } from "./email.js";
import { normaliseEmail } from "./identity.js";

export const ORDER_PREFIX = "order:";
export const PENDING_TTL_SEC = 7 * 24 * 60 * 60;
export const FLW_VERIFY_URL = "https://api.flutterwave.com/v3/transactions/verify_by_reference";
const MAX_LINES = 20;
const MAX_QTY = 100;
const FULFILMENT = { pickup: "Pickup (free)", lagos: "Delivery — Lagos", other: "Delivery — Other Nigerian States" };
const TX_REF_PATTERN = /^xny-\d{10,16}-[a-f0-9]{8}$/;
const REF_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PICKUP_ADDRESS = "1-3 Adebakin Close, Santos Layout, Akowonjo, Alimosho, Lagos";

const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

export const orderKey = (txRef) => `${ORDER_PREFIX}${txRef}`;
export const validTxRef = (v) => typeof v === "string" && TX_REF_PATTERN.test(v);

function newTxRef() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `xny-${Date.now()}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/* ---------------- 1. create ---------------- */

/** Returns { ok: true, order } or { ok: false, status, error, field? }. */
export async function createOrder(kv, input) {
  if (!input || typeof input !== "object") return { ok: false, status: 400, error: "Invalid order." };

  const fulfilment = input.fulfilment;
  if (!FULFILMENT[fulfilment]) return { ok: false, status: 400, field: "fulfilment", error: "Please choose pickup or a delivery option." };

  const c = input.customer && typeof input.customer === "object" ? input.customer : {};
  const customer = { name: clean(c.name, 100), email: clean(c.email, 254), phone: clean(c.phone, 32), address: clean(c.address, 300) };
  if (customer.name.length < 2) return { ok: false, status: 400, field: "name", error: "Please enter your name." };
  if (!EMAIL_PATTERN.test(customer.email) || !normaliseEmail(customer.email)) return { ok: false, status: 400, field: "email", error: "Please enter a valid email address." };
  if (customer.phone.replace(/\D/g, "").length < 7) return { ok: false, status: 400, field: "phone", error: "Please enter a valid phone number." };
  if (fulfilment !== "pickup" && customer.address.length < 5) return { ok: false, status: 400, field: "address", error: "Please enter your delivery address." };
  if (fulfilment === "pickup") customer.address = "";

  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_LINES) return { ok: false, status: 400, field: "items", error: "Your cart is empty." };

  const { config } = await loadCurrent(kv);
  const merged = new Map();
  for (const line of input.items) {
    if (!line || typeof line.id !== "string" || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY || !config.products[line.id]) {
      return { ok: false, status: 400, field: "items", error: "Something in your cart is no longer available. Please review it." };
    }
    merged.set(line.id, (merged.get(line.id) || 0) + line.qty);
  }
  let subtotalKobo = 0;
  const items = [];
  for (const [id, qty] of merged) {
    const price = config.products[id].price_ngn;
    subtotalKobo += Math.round(price * 100) * qty;
    items.push({ id, qty, price_ngn: price });
  }
  const subtotal = subtotalKobo / 100;
  const delivery = fulfilment === "pickup" ? 0 : config.delivery[fulfilment].customer_charge_ngn;
  const total = Math.round((subtotal + delivery) * 100) / 100;
  if (!(total > 0) || total > 100000000) return { ok: false, status: 400, error: "Invalid order total." };

  const refRaw = typeof input.ref_code === "string" ? input.ref_code.trim() : "";
  const order = {
    tx_ref: newTxRef(),
    status: "pending",
    created_at: new Date(Date.now()).toISOString(),
    items,
    subtotal_ngn: subtotal,
    delivery_ngn: delivery,
    total_ngn: total,
    fulfilment,
    pricing_version: config.version,
    commission_rate: config.commission_rate,
    ref_code: REF_CODE_PATTERN.test(refRaw) ? refRaw.toUpperCase() : null,   // bound NOW; the browser can't change it later
    customer
  };
  await kv.put(orderKey(order.tx_ref), JSON.stringify(order), { expirationTtl: PENDING_TTL_SEC, metadata: { s: "pending", t: total, at: order.created_at } });
  return { ok: true, order };
}

/** What the browser needs to open the payment window (never the customer's own details back, never costs). */
export function publicOrder(order) {
  return {
    tx_ref: order.tx_ref,
    amount: order.total_ngn,
    currency: "NGN",
    subtotal: order.subtotal_ngn,
    delivery: order.delivery_ngn,
    pricing_version: order.pricing_version,
    items: order.items
  };
}

/* ---------------- 2. verify with Flutterwave ---------------- */

/** Asks Flutterwave about a tx_ref. Never throws. */
async function askFlutterwave(env, txRef) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${FLW_VERIFY_URL}?tx_ref=${encodeURIComponent(txRef)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${env.FLW_SECRET_KEY}`, "Content-Type": "application/json" },
      signal: controller.signal
    });
    let body = {};
    try { body = await res.json(); } catch (err) { /* handled by the caller */ }
    return { reachable: true, http: res.status, body };
  } catch (err) {
    return { reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

async function notifyAdmin(env, subject, lines) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const text = lines.join("\n");
    const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#14231a;"><pre style="font-family:inherit;white-space:pre-wrap;margin:0;">${esc(text)}</pre></body></html>`;
    const r = await sendViaResend(env, { to: REPLY_TO, subject, html, text });
    return r.ok === true;
  } catch (err) {
    return false;
  }
}

const money = (n) => math.formatNgn(n);

function orderLines(order) {
  return [
    `Order reference (Flutterwave tx_ref): ${order.tx_ref}`,
    "",
    `Fulfilment: ${FULFILMENT[order.fulfilment]}`,
    order.fulfilment === "pickup" ? `Pickup location: ${PICKUP_ADDRESS}` : `Delivery address: ${order.customer.address}`,
    "",
    `Customer: ${order.customer.name}`,
    `Email: ${order.customer.email}`,
    `Phone: ${order.customer.phone}`,
    "",
    "Items:",
    ...order.items.map((i) => `- ${i.id} x ${i.qty} @ ${money(i.price_ngn)} = ${money(i.price_ngn * i.qty)}`),
    "",
    `Subtotal: ${money(order.subtotal_ngn)}`,
    order.fulfilment === "pickup" ? "Pickup: Free" : `Delivery: ${money(order.delivery_ngn)}`,
    `Total: ${money(order.total_ngn)}`,
    order.ref_code ? `Affiliate code on this order: ${order.ref_code}` : "No affiliate code."
  ];
}

async function saveOrder(kv, order, ttl) {
  const options = { metadata: { s: order.status, t: order.total_ngn, at: order.created_at } };
  if (ttl) options.expirationTtl = ttl;
  await kv.put(orderKey(order.tx_ref), JSON.stringify(order), options);
}

/**
 * Settles an order: confirms with Flutterwave, then marks it paid and does the follow-up.
 * Idempotent: settling an order that is already paid changes nothing and sends nothing.
 * Returns { state, ... }:
 *   unknown     no such order (or it expired)
 *   paid        confirmed by Flutterwave for at least the order total
 *   pending     Flutterwave has no successful payment for it (yet)
 *   failed      Flutterwave says the payment failed
 *   underpaid   paid, but for LESS than the order total (or in another currency): not marked paid
 *   unverified  Flutterwave could not be asked right now (the caller should retry)
 */
export async function settleOrder(env, txRef, source) {
  const kv = env.REFERRALS_KV;
  if (!validTxRef(txRef)) return { state: "unknown" };
  const order = await getJson(kv, orderKey(txRef));
  if (!order) return { state: "unknown" };
  if (order.status === "paid") return { state: "paid", order };
  if (!env.FLW_SECRET_KEY) return { state: "unverified", error: "Payment verification is not configured." };

  const answer = await askFlutterwave(env, txRef);
  if (!answer.reachable || answer.http >= 500 || answer.http === 401 || answer.http === 403) {
    if (answer.reachable && (answer.http === 401 || answer.http === 403)) {
      await notifyAdmin(env, "ALERT: payment verification is failing (check FLW_SECRET_KEY)", [
        "Flutterwave refused the verification request (HTTP " + answer.http + "). Orders cannot be confirmed automatically until the secret key is fixed.",
        "",
        ...orderLines(order)
      ]);
    }
    return { state: "unverified", error: "Could not reach the payment provider." };
  }

  const data = answer.body && answer.body.data;
  if (!answer.body || answer.body.status !== "success" || !data) return { state: "pending" };   // no such transaction yet
  const flwStatus = String(data.status || "").toLowerCase();
  if (flwStatus !== "successful") return { state: flwStatus === "failed" ? "failed" : "pending", flw_status: flwStatus };

  // It was paid. Was it paid IN FULL, in naira, against THIS order?
  const paid = Number(data.amount);
  const flw = { id: data.id || null, flw_ref: data.flw_ref || null, amount: paid, currency: data.currency || null, status: flwStatus };
  const reference = data.tx_ref === order.tx_ref;
  const currencyOk = data.currency === "NGN";
  const amountOk = Number.isFinite(paid) && paid + 0.005 >= order.total_ngn;
  if (!reference || !currencyOk || !amountOk) {
    const flagged = !amountOk && reference ? "underpaid" : "mismatch";
    if (order.status === flagged && order.alerted) return { state: "underpaid", order };   // already flagged and the business already told
    order.status = flagged;
    order.flw = flw;
    order.flagged_at = new Date(Date.now()).toISOString();
    order.alerted = true;
    await saveOrder(kv, order, 0);
    await notifyAdmin(env, `ALERT: payment problem on order ${order.tx_ref}`, [
      `Flutterwave reports a successful payment, but it does not match the order: paid ${Number.isFinite(paid) ? money(paid) : "?"} ${flw.currency || ""}, the order total is ${money(order.total_ngn)}.`,
      "The order has NOT been marked paid and no commission was credited. Do not release goods until you have checked it in the Flutterwave dashboard.",
      "",
      ...orderLines(order)
    ]);
    return { state: "underpaid", order };
  }

  // Paid in full. Mark it first, then do the follow-up, so a retry can never double up.
  order.status = "paid";
  order.paid_at = new Date(Date.now()).toISOString();
  order.flw = flw;
  order.verified_by = source || "browser";
  await saveOrder(kv, order, 0);

  try {
    const ref = await recordReferralForOrder(kv, order);
    order.referral = ref.logged ? "credited" : ref.reason;
    await saveOrder(kv, order, 0);
  } catch (err) { /* the sale is paid; commission can be re-run by log-referral */ }

  const sent = await notifyAdmin(env, `New Order — XNY Farms (${order.tx_ref})`, [
    "A customer has paid and the payment has been VERIFIED with Flutterwave.",
    "",
    ...orderLines(order),
    "",
    order.fulfilment === "pickup" ? "This is a PICKUP order. The customer will collect from the address above." : "This order is for delivery."
  ]);
  if (sent) { order.notified = true; await saveOrder(kv, order, 0); }
  return { state: "paid", order };
}
