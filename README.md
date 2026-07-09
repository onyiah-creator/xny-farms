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
│   ├── favicon.svg
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
- [ ] **CAC Registration Number** — replace every `[CAC NUMBER PLACEHOLDER]`
      (appears in footers on all pages, `about.html`, and the legal pages).
- [ ] **Company history** — `about.html`, the `[PLACEHOLDER — founding story]`
      block. Add the real founding year, founders, location, motivation and
      milestones.
- [ ] **Mission / Vision** — review the drafted text in `about.html` and adjust
      to your official wording if you have one.

### Contact details (appear in footers on every page + `contact.html`)
- [ ] **Office / registered address** — replace every `[ADDRESS PLACEHOLDER]`.
- [ ] **Phone number** — replace every `[PHONE PLACEHOLDER]` and the
      `tel:REPLACE` link in `contact.html`.
- [ ] **Email address** — replace every `[EMAIL PLACEHOLDER]` and every
      `REPLACE_WITH_EMAIL@example.com` (in `contact.html`, `wholesale.html`,
      the form `data-mailto` attributes, and legal pages).
- [ ] **Business hours** — `contact.html`, `[HOURS PLACEHOLDER]`.

### Products (`products.html`)
- [ ] **Product descriptions** — replace each `[PRODUCT DESCRIPTION ...]` for
      ASHE Honey, Palm Oil, Agricultural Produce and Value-Added Products.
- [ ] **Pack sizes / grades / current produce lines** — replace the `[...]`
      chips under each product.
- [ ] **Retail pricing / store links** — add when your sales channel is ready.

### Product & site photos (`/assets`)
- [ ] Replace the SVG placeholders with **real photos** (keep the same file
      names to avoid editing HTML, or update the `<img src>` references):
  - `product-honey.svg` → ASHE Honey photo
  - `product-palm-oil.svg` → Palm Oil photo
  - `product-produce.svg` → Agricultural produce photo
  - `product-value-added.svg` → keep as "Coming Soon" until the line launches
  - `about-farm.svg` → farm / team / operations photo
  - `hero-farm.svg` → optional: a real hero background photo
  - `favicon.svg` → optional: your real logo mark
  > If you switch to `.jpg`/`.png`, update the matching `src="assets/..."`
  > paths (and the CSS `--hero` background in `css/styles.css`).

### Wholesale (`wholesale.html`)
- [ ] **Minimum order quantities (MOQ)** — replace `[MOQ PLACEHOLDER]`.

### Contact map (`contact.html`)
- [ ] **Google Map** — the embed currently points to a placeholder Lagos
      location. Replace the `<iframe src="...">` with your real location
      (Google Maps → **Share** → **Embed a map** → copy the `src`).

### Forms (`contact.html` + `wholesale.html`)
- [ ] **Wire up form submission.** Both forms currently fall back to opening a
      pre-filled email draft (`mailto:`). To collect submissions properly:
      1. Create a form endpoint (e.g. a free [Formspree](https://formspree.io)
         form) and copy its URL, e.g. `https://formspree.io/f/abcdxyz`.
      2. In each form, set **both** the `action` and the
         `data-form-endpoint` attributes to that URL.
      3. Also set `data-mailto` to your real inbox as a backup.
      Once `data-form-endpoint` is a real URL (no `REPLACE`/`#`), the form
      posts to it automatically — no JS changes needed.

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
