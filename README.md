# XNY Farms Limited — Marketing Website

A professional, static marketing website for **XNY Farms Limited**, a Nigerian
agricultural business (honey, palm oil and agricultural produce). Built as plain
HTML / CSS / JavaScript with **no framework and no build step**, so it deploys
directly to **Cloudflare Pages** (or any static host) as-is.

---

## 1. Tech & Structure

- **Stack:** plain HTML5, CSS3, vanilla JavaScript. No dependencies, no build.
- **Responsive:** mobile-first, works from small phones to desktop.
- **Design:** agricultural / earthy palette — greens, gold/amber, cream.

```
/
├── index.html            Home
├── products.html         Products (ASHE Honey, Palm Oil, Produce, Value-Added)
├── about.html            About / history / mission / vision / WatchVisionAI
├── wholesale.html        Wholesale info + B2B inquiry form
├── contact.html          Address, phone, email, Google Map, contact form
├── privacy-policy.html    NDPR-compliant privacy policy
├── refund-policy.html    Refund & cancellation policy
├── terms.html            Terms & conditions
├── ndpr-notice.html      NDPR data privacy notice
├── css/
│   └── styles.css        All site styles
├── js/
│   └── main.js           Mobile nav, active links, form handling
├── assets/               Images (SVG placeholders — swap for real photos)
│   ├── favicon.ico
│   ├── favicon-16.png
│   ├── favicon-32.png
│   ├── favicon-48.png
│   ├── favicon-180.png
│   ├── favicon-192.png
│   ├── favicon-512.png
│   ├── hero-farm.svg
│   ├── product-honey.svg
│   ├── product-palm-oil.svg
│   ├── product-produce.svg
│   ├── product-value-added.svg
│   └── about-farm.svg
├── _headers              Cloudflare Pages security headers (optional)
├── wrangler.toml         Cloudflare Pages project config (optional)
└── README.md
```

The header and footer markup is **repeated in each HTML file** (intentionally —
no framework, no JS dependency for core content, best for SEO and KYC review).
If you change a nav or footer link, update it in every `*.html` file.

---

## 2. ✅ Pre-Launch Placeholder Checklist

Everything you must replace is wrapped in `[BRACKETS]` in the source. Search the
project for `[` (or `PLACEHOLDER` / `REPLACE`) to find every spot. Work through
this list before going live or submitting to Flutterwave:

### Company identity
- [x] **CAC Registration Number** — set to `1107007` across footers on all
      pages, `about.html`, and the legal pages.
- [ ] **Company history** — `about.html`, the `[PLACEHOLDER — founding story]`
      block. Add the real founding year, founders, location, motivation and
      milestones.
- [ ] **Mission / Vision** — review the drafted text in `about.html` and adjust
      to your official wording if you have one.

### Contact details (appear in footers on every page + `contact.html`)
- [x] **Office / registered address** — set to `41 Babaponmile Street,
      Onipetesi, Mangoro, Ikeja, Lagos, Nigeria` across all pages.
- [x] **Phone number** — set to `+234 806 013 8299`, including the
      `tel:` link in `contact.html`.
- [x] **Email address** — set to `xnyfarms@gmail.com`, including the
      `mailto:` link in `contact.html` and the `data-mailto` fallback on the
      contact and wholesale forms.
- [ ] **Business hours** — `contact.html`, `[HOURS PLACEHOLDER]`.

### Products (`products.html`)
- [x] **ASHE Honey** — live with real product photos, copy and pricing
      (50cl at &#8358;6,500, 1 Litre at &#8358;12,000) on both `products.html`
      and the homepage featured-products preview.
- [x] **Palm Oil** — live with real product photos, copy and pricing
      (50cl at &#8358;700, 1 Litre at &#8358;1,300) on `products.html`. The
      homepage featured-products preview still shows the `product-palm-oil.svg`
      placeholder — only ASHE Honey was updated there per instructions;
      update the Palm Oil homepage card the same way when ready.
- [ ] **Product descriptions** — replace each `[PRODUCT DESCRIPTION ...]` for
      Agricultural Produce and Value-Added Products.
- [ ] **Pack sizes / grades / current produce lines** — replace the `[...]`
      chips under each remaining placeholder product.
- [ ] **Retail pricing / store links** — add for Agricultural Produce when
      ready.

### Product & site photos (`/assets`)
- [x] `ashe-honey-50cl.png` / `ashe-honey-1l.png` → real ASHE Honey bottle
      photos, in place.
- [x] `palm-oil-50cl.png` / `palm-oil-1l.png` → real Palm Oil bottle
      photos, in place (used on `products.html`; the homepage card still
      references `product-palm-oil.svg`).
- [x] `xny-logo.png` → real XNY Farms logo file, in place and wired into
      the header on all 9 pages via `class="brand__logo"`. Brand colors
      in `css/styles.css` (`#06552A` dark green, `#8CC10F` lime,
      `#DAD905` gold, `#0B4124` dark green text) match the logo exactly.
- [ ] Replace the remaining SVG placeholders with **real photos** (keep the
      same file names to avoid editing HTML, or update the `<img src>`
      references):
  - `product-palm-oil.svg` → still used on the homepage featured card only
  - `product-produce.svg` → Agricultural produce photo
  - `product-value-added.svg` → keep as "Coming Soon" until the line launches
  - `about-farm.svg` → farm / team / operations photo
  - `hero-farm.svg` → optional: a real hero background photo
  > If you switch to `.jpg`/`.png`, update the matching `src="assets/..."`
  > paths (and the CSS `--hero` background in `css/styles.css`).

### Wholesale (`wholesale.html`)
- [ ] **Minimum order quantities (MOQ)** — replace `[MOQ PLACEHOLDER]`.

### Contact map (`contact.html`)
- [ ] **Google Map** — the embed currently points to a placeholder Lagos
      location. Replace the `<iframe src="...">` with your real location
      (Google Maps → **Share** → **Embed a map** → copy the `src`).

### Forms (`contact.html` + `wholesale.html`)
- [x] **Wired up via `mailto:` only, by design — no backend.** Both forms
      submit to `data-mailto="xnyfarms@gmail.com"` with a page-specific
      `data-subject` ("Wholesale Inquiry — XNY Farms" / "Contact Form
      Submission — XNY Farms"). On submit, `js/main.js` validates the
      required fields, builds a `mailto:` link from the entered values,
      and opens the visitor's email client — nothing is posted over the
      network. Each form also shows the inbox address as visible text
      (`xnyfarms@gmail.com`) as a fallback for devices with no configured
      email client.
- [ ] **Optional: switch to a real form backend later.** If you'd rather
      collect submissions server-side instead of relying on `mailto:`,
      wire up a service like [Formspree](https://formspree.io) — add an
      `action`/`method` back to the `<form>` tag pointing at its
      endpoint, and update the `submit` handler in `js/main.js` to let
      that POST through instead of intercepting it.

### Legal pages (`privacy-policy.html`, `refund-policy.html`, `terms.html`, `ndpr-notice.html`)
- [ ] **Dates** — replace every `[DATE]` (last updated date) on all four pages.
- [ ] **Website domain** — replace `[xnyfarms.com]` in `privacy-policy.html`
      and `terms.html` with your real live domain.
- [ ] **Data Protection Officer / compliance contact** —
      `ndpr-notice.html`, `[DPO NAME / COMPLIANCE OFFICER PLACEHOLDER]`.
- [ ] **Refund timeframes** — `refund-policy.html` is drafted with a 48-hour
      return-request window and a 7&ndash;14 business day refund processing
      time. Adjust these if your actual policy differs.
- [ ] **Legal review** — these four pages were provided as pre-drafted legal
      content; have them reviewed by a qualified Nigerian legal adviser
      before relying on them, and confirm the governing-law wording.

### About / Digital Innovation
- [ ] Confirm the **WatchVisionAI** description and the
      `https://watchvisionai.com` link in `about.html`.

> Tip: after editing, grep the project for leftover placeholders:
> `grep -rniE "\[(cac|address|phone|email|hours|date\]|number|product|moq|placeholder|dpo|xnyfarms\.com)" .`
> and `grep -rn "REPLACE" .` — both should return nothing before launch.

---

## 3. Deployment — Cloudflare Pages

This is a **static site with no build step**. Output directory is the **repo
root**.

### Option A — Connect your Git repo (recommended)
1. Push this repository to GitHub/GitLab.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages →
   Connect to Git** and select this repo.
3. Build settings:
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/` (the repository root)
4. Deploy. Cloudflare serves the HTML files directly.

### Option B — Direct upload / Wrangler CLI
```bash
# from the project root
npx wrangler pages deploy . --project-name=xny-farms
```
`wrangler.toml` is included for convenience but is **not required** for a static
site — there is no build to run.

### Custom domain
Add your domain under the Pages project → **Custom domains**, and update DNS as
instructed by Cloudflare.

### Local preview
No server needed — open `index.html` in a browser. For nicer local testing
(so relative paths and the map iframe behave), run any static server:
```bash
python3 -m http.server 8080     # then visit http://localhost:8080
```

---

## 4. Notes for the Flutterwave / KYC Review

This site is structured to satisfy a payment provider's business-verification
(KYC) review. Before submitting, make sure you have:

- [ ] Filled in the **CAC registration number** everywhere.
- [ ] Added a **real company address, phone and email**.
- [ ] Completed the **company history** and product descriptions with real info.
- [ ] Published all four policy pages (Privacy, Refund, Terms, NDPR) with real
      contact details and dates — reviewers specifically look for these.
- [ ] Ensured product photos and pricing reflect what you actually sell.
- [ ] Wired the contact/wholesale forms to a working inbox or endpoint.

Placeholders left in `[BRACKETS]` will be visible to a reviewer — do not submit
until the checklist above is complete.
