/**
 * Unit tests for the shared pricing maths (js/pricing-math.js), which the admin pricing
 * page and the server both use.
 *
 *   node tests/pricing-math.test.mjs
 */
import vm from 'node:vm';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const M = createRequire(import.meta.url)('../js/pricing-math.js');

let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, String(x).slice(0, 300))); };
const R = 0.08, F = 0.0215;

console.log('=== the worked example: N=700, r=8%, f=2.15% ===');
const o700 = { target: 700, r: R, f: F, step: 10 };
check('exact minimum price = 779.08', M.minPriceExact(o700) === 779.08, M.minPriceExact(o700));
check('listed at 780 (rounded UP to the nearest 10)', M.recommendedPrice(o700) === 780);
const b780 = M.breakdown(780, o700);
check('at 780: commission 62.40, fee 16.77, you keep 700.83', b780.commission === 62.4 && b780.fee === 16.77 && b780.net_kept === 700.83, JSON.stringify(b780));
check('...target met, no shortfall', b780.meets_target === true && b780.shortfall === 0 && b780.loses_money === false);
check('at 779 (a naira under the minimum) the target is NOT met', M.breakdown(779, o700).meets_target === false);
const b750 = M.breakdown(750, o700);
check('selling at 750 keeps 673.88: short of 700 by 26.12', b750.net_kept === 673.88 && b750.shortfall === 26.12 && b750.meets_target === false, JSON.stringify(b750));
check('net is worked out once on unrounded figures: price x (1 - r - f)', M.breakdown(1000, { r: R, f: F }).net_kept === 898.5 && M.breakdown(1234, { r: R, f: F }).net_kept === 1108.75, [M.breakdown(1000, { r: R, f: F }).net_kept, M.breakdown(1234, { r: R, f: F }).net_kept].join());

console.log('\n=== rounding up to the step ===');
check('step 1: 779.08 -> 780', M.recommendedPrice({ ...o700, step: 1 }) === 780);
check('step 10: 779.08 -> 780', M.recommendedPrice({ ...o700, step: 10 }) === 780);
check('step 50: 779.08 -> 800', M.recommendedPrice({ ...o700, step: 50 }) === 800);
check('default step is 10 when none is given', M.recommendedPrice({ target: 700, r: R, f: F }) === 780);
check('always rounds UP, never down: 780.01 -> 790 at step 10', M.ceilToStep(780.01, 10) === 790 && M.ceilToStep(789.99, 10) === 790);
check('an exact multiple stays put (no needless +step), even with float noise', M.ceilToStep(780, 10) === 780 && M.ceilToStep(780.0000000001, 10) === 780 && M.ceilToStep(0.1 + 0.2 + 779.7, 10) === 780);
check('step 1 on a whole number', M.ceilToStep(700, 1) === 700 && M.ceilToStep(700.4, 1) === 701);
check('rounding up can only help the business: recommended >= exact minimum, always', [1, 10, 50].every((st) => [100, 700, 1234.56, 6289.5, 11680.5].every((t) => M.recommendedPrice({ target: t, r: R, f: F, step: st }) >= M.minPriceExact({ target: t, r: R, f: F }))));

console.log('\n=== the guarantee: the recommended price always keeps at least the target ===');
{
  let bad = null, n = 0;
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 4000 && !bad; i++) {
    const t = Math.round((50 + rnd() * 20000) * 100) / 100, r = Math.round(rnd() * 0.4 * 10000) / 10000, f = Math.round(rnd() * 0.1 * 10000) / 10000;
    const other = rnd() < 0.3 ? Math.round(rnd() * 300 * 100) / 100 : 0, step = [1, 10, 50][i % 3];
    const P = M.recommendedPrice({ target: t, otherCost: other, r, f, step });
    const b = M.breakdown(P, { r, f, target: t, otherCost: other });
    n++;
    if (!b.meets_target || P % step !== 0) bad = { t, r, f, other, step, P, b };
  }
  check(`4000 random targets / rates / steps / other costs: every recommended price meets its target and is a multiple of the step (${n} checked)`, !bad, JSON.stringify(bad));
}
check('other cost per unit is added to the net before the formula: N=700 + 50 absorbed -> 834.72 -> 840', M.minPriceExact({ target: 700, otherCost: 50, r: R, f: F }) === 834.72 && M.recommendedPrice({ target: 700, otherCost: 50, r: R, f: F, step: 10 }) === 840);
const withOther = M.breakdown(840, { r: R, f: F, target: 700, otherCost: 50 });
check('...and "you keep" is after that cost: at 840 you keep 700.74 + ... = 704.74 - 50 >= 700', withOther.other_cost === 50 && withOther.net_kept >= 700 && withOther.meets_target, JSON.stringify(withOther));
check('zero rates: price = net', M.minPriceExact({ target: 700, r: 0, f: 0 }) === 700);
check('a target of zero costs nothing to cover', M.minPriceExact({ target: 0, r: R, f: F }) === 0);
check('commission is on the price only, the fee on the price too: 100 -> 8.00 and 2.15 (2.15 shown as 2.15)', M.breakdown(100, { r: R, f: F }).commission === 8 && M.breakdown(100, { r: R, f: F }).fee === 2.15);
check('a loss is reported plainly', (b => b.loses_money === true && b.net_kept < 0 && b.shortfall > 700)(M.breakdown(10, { r: 0.5, f: 0.4, target: 700, otherCost: 20 })));

console.log('\n=== invalid rate combinations ===');
for (const [r, f, label] of [[-0.01, 0.02, 'negative commission'], [0.08, -0.001, 'negative fee'], [0.51, 0.02, 'commission over 50%'], [0.08, 0.6, 'fee over 50%'], [0.5, 0.4, 'sum exactly 90%'], [0.5, 0.45, 'sum over 90%'], [NaN, 0.02, 'NaN commission'], [0.08, NaN, 'NaN fee'], [Infinity, 0, 'Infinity'], ['0.08', 0.02, 'a string'], [null, 0.02, 'null'], [undefined, 0.02, 'undefined']]) {
  check(`${label} is rejected with plain words`, typeof M.checkRates(r, f) === 'string' && M.checkRates(r, f).length > 10, String(M.checkRates(r, f)));
}
for (const [r, f, label] of [[0.08, 0.0215, 'the real values'], [0, 0, 'both zero'], [0.5, 0, 'commission at the 50% cap'], [0.5, 0.39, 'sum just under 90%'], [0.08, 0.5, 'fee at the cap']]) {
  check(`${label} is accepted`, M.checkRates(r, f) === null, M.checkRates(r, f));
}
check('the price formula refuses rates it cannot divide by', (() => { try { M.minPriceExact({ target: 700, r: 0.5, f: 0.4 }); return false; } catch (e) { return /under 90%/.test(e.message); } })());

console.log('\n=== delivery ===');
const dPass = M.deliveryCharge({ courierCost: 1500, f: F, passFee: true, step: 10 });
check('fee passed on: 1500 / (1 - 0.0215) = 1532.96 -> charge 1,540', dPass === 1540, dPass);
const dB = M.deliveryBreakdown(dPass, { f: F, courierCost: 1500 });
check('...the processor fee on delivery is 33.11 and 1,506.89 is left, covering the 1,500 courier cost', dB.fee === 33.11 && dB.net === 1506.89 && dB.shortfall === 0 && dB.surplus === 6.89, JSON.stringify(dB));
check('the charge nets to AT LEAST the courier cost for every step', [1, 10, 50].every((st) => M.deliveryBreakdown(M.deliveryCharge({ courierCost: 1500, f: F, passFee: true, step: st }), { f: F, courierCost: 1500 }).shortfall === 0));
check('step 1 gives the tightest charge (1,533) and still covers the cost', M.deliveryCharge({ courierCost: 1500, f: F, passFee: true, step: 1 }) === 1533 && M.deliveryBreakdown(1533, { f: F, courierCost: 1500 }).shortfall === 0);
const dNo = M.deliveryCharge({ courierCost: 1500, f: F, passFee: false, step: 10 });
check('fee NOT passed on: the charge equals the courier cost', dNo === 1500);
const dNoB = M.deliveryBreakdown(dNo, { f: F, courierCost: 1500 });
check('...so the business absorbs the fee: 1,500 - 32.25 = 1,467.75, short of the courier cost by 32.25', dNoB.fee === 32.25 && dNoB.net === 1467.75 && dNoB.shortfall === 32.25, JSON.stringify(dNoB));
check('a zero courier cost charges nothing', M.deliveryCharge({ courierCost: 0, f: F, passFee: true, step: 10 }) === 0);
{
  let bad = null; let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 3000 && !bad; i++) {
    const cost = Math.round(rnd() * 20000 * 100) / 100, f = Math.round(rnd() * 0.1 * 10000) / 10000, st = [1, 10, 50][i % 3];
    const c = M.deliveryCharge({ courierCost: cost, f, passFee: true, step: st });
    if (M.deliveryBreakdown(c, { f, courierCost: cost }).shortfall > 0.005 || c % st !== 0) bad = { cost, f, st, c };
  }
  check('3000 random courier costs / fees / steps: the passed-on charge always nets to the courier cost', !bad, JSON.stringify(bad));
}

console.log('\n=== a whole order (admin preview) ===');
const order = M.orderPreview({ items: [{ price: 780, qty: 2 }], deliveryCharge: 1540, courierCost: 1500, r: R, f: F });
check('2 x 780 + 1,540 delivery: customer pays 3,100', order.subtotal === 1560 && order.delivery_charge === 1540 && order.total_charged === 3100, JSON.stringify(order));
check('processor fee is on the WHOLE 3,100 (66.65); commission only on the 1,560 products (124.80)', order.processor_fee === 66.65 && order.commission === 124.8, JSON.stringify(order));
check('you keep 3,100 - 66.65 - 124.80 - 1,500 courier = 1,408.55', order.net_kept === 1408.55 && order.delivery_cost === 1500, JSON.stringify(order));
const pickup = M.orderPreview({ items: [{ price: 780, qty: 1, other_cost: 10 }], deliveryCharge: 0, courierCost: 0, r: 0, f: F });
check('a pickup order with no affiliate and 10 of other cost: 780 - 16.77 - 10 = 753.23', pickup.net_kept === 753.23 && pickup.other_costs === 10 && pickup.commission === 0, JSON.stringify(pickup));

console.log('\n=== formatting ===');
check('formatRate', M.formatRate(0.08) === '8%' && M.formatRate(0.0215) === '2.15%' && M.formatRate(0.075) === '7.5%' && M.formatRate(0) === '0%' && M.formatRate(0.5) === '50%');
check('formatNgn', M.formatNgn(780) === '₦780' && M.formatNgn(700.83) === '₦700.83' && M.formatNgn(1234567.5) === '₦1,234,567.50' && M.formatNgn(-26.12) === '-₦26.12' && M.formatNgn(0) === '₦0');
check('round2', M.round2(1.005) === 1.01 && M.round2(2.675) === 2.68 && M.round2(0.1 + 0.2) === 0.3);

console.log('\n=== one file, two homes: it loads as a browser global and as a module ===');
{
  const code = fs.readFileSync(new URL('../js/pricing-math.js', import.meta.url), 'utf8');
  const sandbox = { self: {} }; sandbox.self = sandbox;
  vm.runInNewContext(code, sandbox);
  check('in a browser it defines window.XNYPricingMath with the same maths', sandbox.XNYPricingMath && sandbox.XNYPricingMath.recommendedPrice(o700) === 780 && sandbox.XNYPricingMath.breakdown(780, o700).net_kept === 700.83);
  check('in Node it is a CommonJS module (what the Pages Functions import)', typeof M.recommendedPrice === 'function' && Object.keys(M).includes('orderPreview'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
