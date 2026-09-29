/**
 * Per-product social share previews.
 *
 * WHY THIS EXISTS
 * A share link points at one product on a shared page:
 *   /products.html?p=ashe-honey-50cl&ref=CODE#ashe-honey-50cl
 *
 * The "#ashe-honey-50cl" fragment is what scrolls a human to the right card,
 * but a fragment is never sent to the server — browsers strip it from the
 * request. WhatsApp, Facebook and X fetch the URL server-side and read the
 * HTML's meta tags, so from their point of view every product share is just
 * "/products.html" and all four would preview identically.
 *
 * The "?p=" query IS sent. This middleware reads it and swaps in that
 * product's og:/twitter: tags before the page goes out, so each product
 * previews with its own card. Humans are unaffected: they still get the same
 * products.html, and the fragment still scrolls them to the card.
 *
 * SAFETY
 * This runs in front of every request to the site, so it is written to get
 * out of the way immediately: no "?p=" (which is every normal visit, every
 * /api/ call, every asset) means an instant pass through to next(). The whole
 * body is wrapped in try/catch and falls back to the untouched response,
 * because a bug here must never be able to take the site down.
 *
 * Scrapers do not run JavaScript, which is also why the tags are rewritten
 * server-side rather than set from js/share.js.
 */

/* Title and description per product. Prices deliberately live only in
   js/cart.js (and the generated card images, which tools/generate-og-images.mjs
   builds from that same catalogue) so there is no third copy to drift. */
const OG_PRODUCTS = {
  "ashe-honey-50cl": {
    title: "ASHE Honey — 50cl | XNY Farms",
    description:
      "100% pure, raw, unfiltered and unpasteurized honey. No additives, no added sugar, no preservatives. Product of Nigeria."
  },
  "ashe-honey-1l": {
    title: "ASHE Honey — 1 Litre | XNY Farms",
    description:
      "100% pure, raw, unfiltered and unpasteurized honey. No additives, no added sugar, no preservatives. Product of Nigeria."
  },
  "palm-oil-50cl": {
    title: "Palm Oil — 50cl | XNY Farms",
    description:
      "100% pure, natural palm oil. No additives, no preservatives, rich in vitamins A & E. Traditionally processed. Product of Nigeria."
  },
  "palm-oil-1l": {
    title: "Palm Oil — 1 Litre | XNY Farms",
    description:
      "100% pure, natural palm oil. No additives, no preservatives, rich in vitamins A & E. Traditionally processed. Product of Nigeria."
  }
};

const PRODUCT_PATHS = new Set(["/products.html", "/products"]);

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Replace the content="…" of one meta tag, matched by its property/name. */
function setMeta(html, attr, key, value) {
  const pattern = new RegExp(
    `(<meta\\s+${attr}=["']${key}["']\\s+content=["'])[^"']*(["'])`,
    "i"
  );
  return html.replace(pattern, `$1${escapeAttr(value)}$2`);
}

export async function onRequest(context) {
  const { request, next } = context;

  try {
    const url = new URL(request.url);
    const productId = url.searchParams.get("p");

    // The overwhelmingly common case: nothing to do, get out of the way.
    if (!productId) return next();
    if (!PRODUCT_PATHS.has(url.pathname)) return next();

    const product = OG_PRODUCTS[productId];
    if (!product) return next();

    const response = await next();
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return response;

    // Absolute URLs, built from the request's own origin so this works on
    // the live domain and on preview deployments alike — scrapers reject
    // relative image paths.
    const origin = url.origin;
    const image = `${origin}/assets/og/${productId}.jpg`;
    const canonical = `${origin}${url.pathname}?p=${encodeURIComponent(productId)}#${productId}`;

    let html = await response.text();
    html = setMeta(html, "property", "og:title", product.title);
    html = setMeta(html, "property", "og:description", product.description);
    html = setMeta(html, "property", "og:image", image);
    html = setMeta(html, "property", "og:image:alt", product.title);
    html = setMeta(html, "property", "og:url", canonical);
    html = setMeta(html, "name", "twitter:title", product.title);
    html = setMeta(html, "name", "twitter:description", product.description);
    html = setMeta(html, "name", "twitter:image", image);

    const headers = new Headers(response.headers);
    headers.delete("content-length"); // body length changed
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (err) {
    // Never let a preview tweak break the page itself.
    return next();
  }
}
