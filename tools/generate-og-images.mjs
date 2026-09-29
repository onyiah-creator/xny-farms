/**
 * Generates the 1200x630 social share cards in assets/og/.
 *
 * The site itself still has NO build step — these images are generated
 * once, committed, and served as plain static files. Re-run this only
 * when a product photo, name or price changes:
 *
 *   NODE_PATH=/opt/node22/lib/node_modules \
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *   node tools/generate-og-images.mjs
 *
 * Why generate anything at all: the product photos are 800x1000 portrait,
 * and every social platform crops previews to roughly 1.91:1 landscape.
 * Feeding them the raw photo gets the bottle cropped through the middle.
 * These cards put the photo on a brand background at the right ratio, so
 * the product reads clearly at thumbnail size.
 *
 * Prices and names are read out of js/cart.js so this can't drift from
 * the catalogue the cart and share buttons already use.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

/* ESM ignores NODE_PATH, so resolve playwright from a normal install first
   and fall back to the paths NODE_PATH names (how it's installed here). */
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
const OUT_DIR = ROOT + "assets/og";

/** Pull the PRODUCTS catalogue out of js/cart.js — single source of truth. */
function loadCatalogue() {
  const src = readFileSync(ROOT + "js/cart.js", "utf8");
  const match = src.match(/var PRODUCTS = (\{[\s\S]*?\n {2}\});/);
  if (!match) throw new Error("Could not find PRODUCTS in js/cart.js");
  // Our own source file, evaluated to reuse the exact literal.
  return new Function("return " + match[1])();
}

const dataUri = (relPath) =>
  "data:image/png;base64," + readFileSync(ROOT + relPath).toString("base64");

const naira = (n) => "₦" + n.toLocaleString("en-NG");

function cardHtml({ photo, logo, name, size, price, tagline }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 1200px; height: 630px; overflow: hidden;
         font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif;
         display: flex; background: #faf6ee; }
  /* The source photos are 800x1000 with generous built-in whitespace, so the
     bottle renders small if simply contained. Scaling up inside an
     overflow-hidden panel crops that padding back off and lets the product
     fill the card, which is the whole point of a share preview. */
  .photo { width: 505px; height: 630px; flex: 0 0 auto; background: #ffffff;
           display: flex; align-items: center; justify-content: center;
           padding: 16px; overflow: hidden; }
  .photo img { max-width: 100%; max-height: 100%; object-fit: contain;
               transform: scale(1.32); }
  .body { flex: 1; padding: 56px 60px; display: flex; flex-direction: column;
          justify-content: center; position: relative;
          background: linear-gradient(135deg, #06552a 0%, #043d1e 100%); }
  .logo { height: 76px; width: auto; background: #fff; border-radius: 12px;
          padding: 10px 16px; align-self: flex-start; margin-bottom: 34px; }
  .name { font-size: 62px; font-weight: 800; color: #ffffff; line-height: 1.06;
          letter-spacing: -0.5px; }
  .size { font-size: 34px; font-weight: 700; color: #8cc10f; margin-top: 10px; }
  .price { font-size: 66px; font-weight: 800; color: #dad905; margin-top: 26px; }
  .tagline { font-size: 23px; color: #e7f3d9; margin-top: 26px; max-width: 30ch;
             line-height: 1.4; }
  .flag { position: absolute; right: 60px; bottom: 44px; font-size: 20px;
          font-weight: 700; color: #b9c0a6; letter-spacing: .12em; text-transform: uppercase; }
  </style></head><body>
    <div class="photo"><img src="${photo}" alt=""></div>
    <div class="body">
      <img class="logo" src="${logo}" alt="">
      <div class="name">${name}</div>
      <div class="size">${size}</div>
      <div class="price">${price}</div>
      <div class="tagline">${tagline}</div>
      <div class="flag">Product of Nigeria</div>
    </div>
  </body></html>`;
}

function defaultCardHtml({ logo, honey, palm }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 1200px; height: 630px; overflow: hidden;
         font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif;
         background: linear-gradient(135deg, #06552a 0%, #043d1e 100%);
         display: flex; align-items: center; padding: 0 70px; gap: 48px; }
  .copy { flex: 1; }
  .logo { height: 96px; background: #fff; border-radius: 14px; padding: 12px 20px;
          margin-bottom: 36px; }
  h1 { font-size: 60px; font-weight: 800; color: #fff; line-height: 1.08;
       letter-spacing: -0.5px; }
  p { font-size: 26px; color: #e7f3d9; margin-top: 24px; max-width: 26ch; line-height: 1.4; }
  .shots { display: flex; gap: 20px; flex: 0 0 auto; }
  .shot { width: 210px; height: 470px; background: #fff; border-radius: 18px;
          display: flex; align-items: center; justify-content: center;
          padding: 10px; overflow: hidden; }
  .shot img { max-width: 100%; max-height: 100%; object-fit: contain;
              transform: scale(1.3); }
  </style></head><body>
    <div class="copy">
      <img class="logo" src="${logo}" alt="">
      <h1>Pure Nigerian honey &amp; palm oil</h1>
      <p>Naturally sourced, carefully handled &mdash; for homes, retailers and wholesale buyers.</p>
    </div>
    <div class="shots">
      <div class="shot"><img src="${honey}" alt=""></div>
      <div class="shot"><img src="${palm}" alt=""></div>
    </div>
  </body></html>`;
}

const TAGLINES = {
  "ashe-honey-50cl": "100% pure, raw, unfiltered honey. No additives, no added sugar.",
  "ashe-honey-1l": "100% pure, raw, unfiltered honey. No additives, no added sugar.",
  "palm-oil-50cl": "100% pure, natural palm oil. Rich in vitamins A &amp; E.",
  "palm-oil-1l": "100% pure, natural palm oil. Rich in vitamins A &amp; E."
};

const catalogue = loadCatalogue();
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });

const logo = dataUri("assets/xny-logo.png");

for (const [id, product] of Object.entries(catalogue)) {
  const html = cardHtml({
    photo: dataUri(product.image),
    logo,
    name: product.name,
    size: product.size,
    price: naira(product.price),
    tagline: TAGLINES[id] || ""
  });
  await page.setContent(html, { waitUntil: "load" });
  const buffer = await page.screenshot({ type: "jpeg", quality: 86 });
  writeFileSync(`${OUT_DIR}/${id}.jpg`, buffer);
  console.log(`  ${id}.jpg  ${(buffer.length / 1024).toFixed(0)} KB`);
}

await page.setContent(defaultCardHtml({
  logo,
  honey: dataUri(catalogue["ashe-honey-50cl"].image),
  palm: dataUri(catalogue["palm-oil-50cl"].image)
}), { waitUntil: "load" });
const fallback = await page.screenshot({ type: "jpeg", quality: 86 });
writeFileSync(`${OUT_DIR}/default.jpg`, fallback);
console.log(`  default.jpg  ${(fallback.length / 1024).toFixed(0)} KB`);

await browser.close();
console.log("Done — cards written to assets/og/");
