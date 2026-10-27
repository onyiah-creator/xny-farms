/**
 * Test helper: put a real, server-priced, Flutterwave-verified order into a KV, the same way
 * production does (create the order, then settle it against a mocked Flutterwave "successful" reply).
 * Commission is only ever credited from a paid order, so tests that need a recorded sale use this.
 * env needs REFERRALS_KV and FLW_SECRET_KEY; RESEND_API_KEY is optional (the admin notification is skipped without it).
 */
import { createOrder, settleOrder, FLW_VERIFY_URL } from '../../functions/_lib/orders.js';

const BUYER = { name: 'Buyer One', email: 'buyer@example.com', phone: '0803 123 4567', address: '' };

export async function placeOrder(env, { items, ref_code, fulfilment = 'pickup', customer = {} }) {
  const r = await createOrder(env.REFERRALS_KV, { items, ref_code, fulfilment, customer: { ...BUYER, address: '1 Test Street, Lagos', ...customer } });
  if (!r.ok) throw new Error('placeOrder failed: ' + r.error);
  return r.order;
}

export async function payOrder(env, order, { amount = order.total_ngn, status = 'successful' } = {}) {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).startsWith(FLW_VERIFY_URL)
    ? new Response(JSON.stringify({ status: 'success', data: { id: 1, tx_ref: order.tx_ref, flw_ref: 'FLW-T', amount, currency: 'NGN', status } }), { status: 200 })
    : prev(url, init);
  try { return await settleOrder(env, order.tx_ref, 'test'); } finally { globalThis.fetch = prev; }
}

export async function paidSale(env, input) {
  const order = await placeOrder(env, input);
  const result = await payOrder(env, order);
  return { order, tx_ref: order.tx_ref, state: result.state };
}
