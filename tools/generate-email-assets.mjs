/**
 * Generates the small images used by the affiliate welcome email into
 * assets/email/. Committed as static files; the site has no build step.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules \
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *   node tools/generate-email-assets.mjs
 *
 * Why these exist rather than reusing the site's images:
 *  - assets/xny-logo.png is ~900 KB. Hot-linking that from an email is slow
 *    and is one more thing spam filters weigh. The email logo is a few KB.
 *  - Inline SVG is unreliable across email clients (Gmail strips it), so the
 *    X mark has to be a raster image there. It is rendered from the exact
 *    same path as the footer icon so the two always match.
 *
 * Both are drawn at 2x their display size so they stay sharp on retina
 * screens.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = ["playwright", "playwright-core"];
  for (const dir of (process.env.NODE_PATH || "").split(":").filter(Boolean)) {
    candidates.push(`${dir}/playwright`, `${dir}/playwright-core`);
  }
  for (const name of candidates) {
    try { return require(name); } catch (err) { /* try the next one */ }
  }
  throw new Error("playwright not found — install it, or set NODE_PATH to its directory");
}
const { chromium } = loadPlaywright();
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = ROOT + "assets/email";
mkdirSync(OUT, { recursive: true });

// The X (formerly Twitter) mark — the same path as the footer icon.
const X_PATH =
  "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });

// ---- X icons: 56x56 px (displayed at 28x28), on transparent ----
// x-icon-white.png is the one the email uses now: the "Follow us on X" pill
// has a dark fill so it survives dark mode, and a white mark on dark is
// legible in any scheme (Gmail's dark mode inverts backgrounds and text but
// never images, so the old black mark on a light pill became black-on-dark).
// x-icon.png (black) is still generated and still served ONLY so that welcome
// emails already sent, which reference its URL, keep their icon.
for (const [file, fill] of [["x-icon-white.png", "#ffffff"], ["x-icon.png", "#000000"]]) {
  const page = await browser.newPage({ viewport: { width: 56, height: 56 } });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="56" height="56">
      <path fill="${fill}" d="${X_PATH}"/></svg></body></html>`);
  const png = await page.screenshot({ type: "png", omitBackground: true });
  writeFileSync(`${OUT}/${file}`, png);
  console.log(`  ${file}  ${png.length} bytes`);
  await page.close();
}

// ---- Logo: 440x193 px (displayed at 220x97), flattened onto white ----
{
  const logoUri = "data:image/png;base64," + readFileSync(ROOT + "assets/xny-logo.png").toString("base64");
  const page = await browser.newPage({ viewport: { width: 440, height: 193 } });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#ffffff">
    <img src="${logoUri}" style="display:block;width:440px;height:193px" alt=""></body></html>`);
  // JPEG, not PNG: opaque artwork on white, and several times smaller.
  const jpg = await page.screenshot({ type: "jpeg", quality: 90 });
  writeFileSync(`${OUT}/logo-email.jpg`, jpg);
  console.log(`  logo-email.jpg  ${(jpg.length / 1024).toFixed(0)} KB`);
  await page.close();
}

await browser.close();
console.log("Done — assets written to assets/email/");
