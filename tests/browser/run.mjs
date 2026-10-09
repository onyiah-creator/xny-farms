/**
 * Browser tests (headless Chromium via Playwright): the password show/hide toggle and
 * the automatic affiliate signup pages.
 *
 *   NODE_PATH=/path/to/node_modules node tests/browser/run.mjs
 *
 * Needs Playwright (it is not a dependency of the site). It looks for `playwright` /
 * `playwright-core` on NODE_PATH, and for Chromium at $PLAYWRIGHT_CHROMIUM_PATH
 * (default /opt/pw-browsers/chromium). The site's real /api functions run against an
 * in-memory KV (see harness.mjs); Resend and Turnstile are mocked. Screenshots go to
 * $SHOTS_DIR if set.
 */
import { createRequire } from "node:module";
import { startHarness } from "./harness.mjs";
import passwordToggle from "./password-toggle.mjs";
import signupFlow from "./signup-flow.mjs";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const names = ["playwright", "playwright-core"];
  for (const dir of (process.env.NODE_PATH || "").split(":").filter(Boolean)) names.push(`${dir}/playwright`, `${dir}/playwright-core`);
  for (const n of names) { try { return require(n); } catch (e) { /* next */ } }
  throw new Error("playwright not found: set NODE_PATH to the directory that contains it");
}
const { chromium } = loadPlaywright();

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? (pass++, console.log("  PASS", name)) : (fail++, console.log("  FAIL", name, String(detail).slice(0, 300))); };

const harness = await startHarness(Number(process.env.PORT || 9455));
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = { browser, harness, base: harness.base, check, shots: process.env.SHOTS_DIR || null };
try {
  console.log("=== password show/hide toggle ===");
  await passwordToggle(ctx);
  console.log("\n=== affiliate signup pages ===");
  await signupFlow(ctx);
} finally {
  await browser.close();
  await harness.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
