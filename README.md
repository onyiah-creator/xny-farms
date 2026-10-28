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
├── cart.html             Cart + checkout (Flutterwave payment)
├── site.webmanifest      Web app manifest (home-screen / PWA icons)
├── css/
│   └── styles.css        All site styles
├── js/
│   ├── main.js           Mobile nav, active links, form handling
│   ├── cart.js           Cart core (localStorage) + header badge — loaded on every page
│   └── checkout.js       cart.html only: rendering, delivery totals, Flutterwave checkout
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
      (50cl at &#8358;7,000, 1 Litre at &#8358;13,000) on both `products.html`
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
- [x] **Working B2B checkout portal** — `cart.html` provides a full cart +
      Flutterwave Inline Checkout flow (see Section 5 below). Add your
      Flutterwave **public** key to `js/checkout.js` before this satisfies a
      KYC reviewer asking to see a live payment flow.

Placeholders left in `[BRACKETS]` will be visible to a reviewer — do not submit
until the checklist above is complete.

---

## 5. Cart, Checkout & Payments (Flutterwave)

`cart.html` holds the cart in the browser and takes payment with **Flutterwave's
Inline Checkout JS SDK**. The browser only collects the order and opens the payment
window: the **server** prices the order and confirms the payment (see *How an order
works now* below).

### How it works
- **Cart storage:** `js/cart.js` keeps cart contents (product id, name, size,
  unit price, quantity) in `localStorage` under the key `xny_cart`, and drives
  the header cart icon/badge that appears on all 9 pages plus `cart.html`.
  The product catalog there holds only each product's id, name, size and
  image. **Prices are not in code any more:** they come from the admin-editable
  pricing config (see *Pricing, fees and commission* below). The cart stores
  only `{ id, qty }`, and the price is looked up when the cart is drawn and at
  checkout.
- **"Add to Cart" buttons** on `products.html` and the homepage featured cards
  (ASHE Honey, Palm Oil) use a `data-add-to-cart="<product-id>"` attribute;
  `js/cart.js` wires them up automatically. "Enquire to Order" was removed
  from these retail product cards now that a real checkout exists — bulk /
  wholesale buyers are still served separately via the dedicated
  **Wholesale Enquiry** flow (nav + `wholesale.html`), linked from a note
  under each product section on `products.html`.
- **Delivery fee:** `cart.html` offers a Lagos / Other Nigerian States choice
  (or free pickup). The customer charges are set on `admin-pricing.html`
  (they used to be constants in `js/checkout.js`).
- **Checkout:** after "Proceed to Checkout", the visitor enters name, email,
  phone and delivery address, then "Pay Now" opens Flutterwave's Inline
  Checkout modal for the total **the server calculated** (subtotal + delivery) in NGN,
  with the server's `tx_ref` (`xny-<ms>-<8 hex>`).

### ⚠️ You must add your Flutterwave public key
`js/checkout.js` ships with a placeholder:
```js
var FLUTTERWAVE_PUBLIC_KEY = "YOUR_FLUTTERWAVE_PUBLIC_KEY_HERE";
```
Replace this with your real **public** key from the Flutterwave dashboard.
Until you do, "Pay Now" shows a friendly "online payment isn't configured
yet" message instead of trying to open the checkout modal — the site stays
functional, it just won't take real payments.

### How an order works now (server-priced, server-verified)
The browser **never decides what an order costs or whether it was paid.**

1. **Pay Now** sends the cart's product ids and quantities (never prices), the delivery choice, the
   customer's details and the referral code to `POST /api/create-order`. The server prices the cart
   from the live pricing config, stores `order:{tx_ref}` as **pending** (7-day expiry) and replies with
   the `tx_ref` (`xny-<ms>-<8 random hex>`) and the amount to charge.
2. The Flutterwave window opens with **that** `tx_ref` and amount. (If the amount differs from the
   total on screen, the shopper is told "Prices were updated" and nothing is charged.)
3. When the window reports success, the page calls `POST /api/verify-order`. The server asks
   **Flutterwave** (`verify_by_reference`, with the secret key) and only marks the order **paid** if
   the transaction is `successful`, in `NGN`, for the right `tx_ref`, and for **at least the order total**.
   Flutterwave's **webhook** (`POST /api/flutterwave-webhook`) does the same check, so an order is still
   confirmed if the customer closes the tab. Both paths are idempotent: one order, one email, one commission.
4. Only then is the affiliate credited (at the price and rate fixed when the order was **created**) and
   `xnyfarms@gmail.com` emailed "New Order — XNY Farms (tx_ref)" with the customer's details and the
   verified payment. The old browser `mailto:` notification is gone.

If a payment is **short** (someone edits the amount in Flutterwave's window), the order becomes
`underpaid`: not paid, no commission, no order email, and you get an **ALERT** email saying not to
release goods. The shopper is shown their reference and asked to contact you. If Flutterwave can't be
reached the order stays pending and is retried (the page retries; the webhook answers 503 so Flutterwave
retries). If Flutterwave rejects our secret key you are emailed that verification is failing.

**Setup (Cloudflare Pages -> Settings -> Environment variables, then redeploy):**

| Variable | Value |
| --- | --- |
| `FLW_SECRET_KEY` | Your Flutterwave **secret** key (dashboard -> Settings -> API). Server only: never in the repo or the browser. Without it `/api/create-order` answers 503 and **checkout is unavailable**, by design: an order that cannot be verified must never be accepted. |
| `FLW_SECRET_HASH` | A long random string you invent, also entered as the **Secret hash** under Flutterwave dashboard -> Settings -> Webhooks. |

Also add the webhook URL `https://xnyfarms.com/api/flutterwave-webhook` there. Then make one **small
real payment** to confirm it end to end (the code follows Flutterwave's documented response shape, but
it could only be tested against a mock, never the live API).

Flutterwave remains your record of money received: reconcile against its dashboard as usual.

---

---

## 6. Social share previews (Open Graph)

Every page carries Open Graph and Twitter Card tags, so a link pasted into
WhatsApp, Facebook or X previews with a title, description and a 1200x630
image instead of a bare URL.

### Per-product previews — and the catch that shapes the design
A product share link looks like:

```
https://xnyfarms.com/products.html?p=ashe-honey-50cl&ref=ADEBAYO01#ashe-honey-50cl
```

Both the `?p=` and the `#fragment` name the same product, and both are needed
for different readers:

- the **fragment** scrolls a person to the right product card, but is **never
  sent to the server** — browsers strip it from the request;
- **`?p=` is sent**, and `functions/_middleware.js` uses it to swap in that
  product's own preview card before the HTML goes out.

Social scrapers fetch the URL server-side and don't run JavaScript, so without
`?p=` they would only ever see plain `/products.html` and **all four products
would preview with the same generic image**. That is the whole reason the
middleware exists.

The middleware gets out of the way immediately on any request without `?p=`
(every normal visit, every `/api/` call, every asset) and is wrapped in
try/catch that falls back to the untouched response — it sits in front of the
whole site, so it must never be able to break it.

### The card images
`assets/og/*.jpg` — one per product plus `default.jpg` for every other page.
They're generated, then committed and served as ordinary static files, so
**the site still has no build step**. Regenerate only when a product photo,
name or price changes:

```bash
node tools/generate-og-images.mjs
```

The generator reads names and prices straight out of `js/cart.js`, so the
cards can't drift from the catalogue the cart uses. Product photos are
800x1000 portrait while every platform crops previews to roughly 1.91:1
landscape, which is why the raw photo isn't used directly — it would be
cropped through the middle of the bottle.

After regenerating, platforms may keep serving the old image from their own
cache. Force a re-fetch with
[Facebook's Sharing Debugger](https://developers.facebook.com/tools/debug/)
or [X's Card Validator](https://cards-dev.twitter.com/validator).

### A shared link shows only that product
Opening `products.html?p=<id>` shows just that one product, not the whole
catalogue, with a "View all products" link back. The same `?p=` drives both
halves of a share: the preview card a scraper sees, and the focused page a
person lands on.

An inline script in `products.html`'s `<head>` sets `data-focus-product` on
`<html>`, and `css/styles.css` does the hiding. It's inline and in the head on
purpose — anywhere later and every product would flash up before being hidden.
The order is hide-then-reveal, so the wrong products are never painted. If the
id matches no product the full catalogue is restored rather than showing an
empty page, and with JavaScript off the attribute is never set, so everything
renders normally.

### Adding a new product
1. Add it to `PRODUCTS` in `js/cart.js`.
2. Add its title/description to `OG_PRODUCTS` in `functions/_middleware.js`.
3. Re-run `node tools/generate-og-images.mjs`.
4. Give its card an `id` on `products.html` (inside a `.product-group`) and a
   `data-share-product` button. The `id` is what both the focused view and the
   `#fragment` scroll rely on, so it must match the catalogue id exactly.

---

## 7. Referral / affiliate programme

Distributors and affiliates get a referral link. When someone arrives via
that link and completes a purchase, the order is logged against their code
and **8% of the order subtotal** (delivery fees excluded) is recorded as
commission owed.

### Pricing, fees and commission (admin-editable)
Product prices, delivery charges, the affiliate commission rate and the
payment-processor fee are edited on **`/admin-pricing.html`** (linked from
`admin.html`; password-gated, noindexed, no-store). Open it, sign in with
`ADMIN_REPORT_PASSWORD`, change what you need, add a note, **Review changes**
(it lists exactly what will change), then save.

**How it is stored.** Every save writes a new, immutable snapshot
`pricing:v{n}` (products with price / target net / other cost, commission rate,
processor fee rate, delivery courier costs and customer charges, whether the fee
on delivery is passed on, the rounding step, and your note) and then moves the
pointer `pricing:current`. Nothing is overwritten or deleted, so the version
list is the change log, and **Revert** saves a *new* version that copies an old
one. Until the first save, the built-in version 1 (today's prices, 8%, fee 2.15%,
delivery 1,500 / 3,500) is used; the first save writes it down as v1 and adds v2.

**What is public.** `GET /api/pricing` returns only the version, each product's
id / name / size / price, the delivery charges and the commission rate, cached
for 30 seconds. The processor fee, target nets, other costs and courier costs
exist only behind the password. **Changes reach new orders within about a
minute** (30s browser cache plus KV propagation); checkout re-fetches the
prices with no cache right before payment.

**The calculator** (`js/pricing-math.js`, one file used by both the page and the
server). With `r` the commission rate (on the product price only) and `f` the
processor fee rate (on the whole amount charged):

```
price to keep net N per item   P = (N + other cost) / (1 - r - f)   rounded UP to the step (1, 10 or 50)
worked check: N = 700, r = 8%, f = 2.15%  ->  779.08, listed at 780, you keep 700.83
delivery charge (fee passed on) = courier cost / (1 - f), rounded up, so delivery nets to the courier cost
```

The page shows, for each product, the recommended price, a **Use recommended**
button, and for whatever price you type the commission, the processor fee and
what you keep, with a red plain-words warning if that is under your target
("You keep ₦673.88 instead of ₦700, short by ₦26.12"). Saving a price below the
recommendation asks you to confirm. The processor-fee percentage is a single
rate you choose: Flutterwave's real fee varies by payment method and can include
flat fees or caps, so check their pricing and pick a rate that covers your usual
method. There is also a sample-order preview and delivery cost cards (with a
manual override of the customer charge, showing the effect).

**Commission is recorded against the price in force when the order was placed.**
`/api/create-order` prices the cart from the live config and stores the `pricing_version`, the item
prices and the `commission_rate` **on the order itself**, and binds the referral code. When Flutterwave
confirms payment the server writes `referral:{CODE}:{tx_ref}` from that stored order: `commission = the
order's rate x the order's subtotal`, with `pricing_version`, `items`, `commission_rate`,
`commission_ngn` and `order_total_ngn`. A price or rate change between creating and paying an order
changes nothing for that order. **Records are never recomputed:** the report, affiliate stats and
payouts all read each record's stored amount; only a very old record with no stored amount or rate
falls back to 8%. (Records written before server-side orders may carry `legacy` / `price_mismatch`
flags, still shown in the admin report.) The rate shown to people ("earn 8%" on the signup pages,
`my-stats.html` and the emails, read from KV when an email is sent) is the current one, for display
only. (The static `<meta>` / social descriptions on `affiliate-signup.html` still say 8%; they can't
be updated by script.)

**The storefront.** `products.html` and `index.html` mark each price with
`data-product-id` and update it from the API; the baked-in price stays as the
no-JavaScript fallback (so keep it roughly current, it's not the source of truth).
The cart shows a one-line "Prices were updated" notice if the price now in force
differs from what the shopper was shown, and **checkout will not start payment if
the prices can't be fetched** (it shows a retry message), or if they changed while
the shopper was looking at the total (they are told and asked to press Pay again).

### Creating a referral link for a distributor
Append `?ref=THEIRCODE` to any page URL — usually the homepage:

```
https://xnyfarms.com/?ref=ADEBAYO01
https://xnyfarms.com/products.html?ref=LAGOSDIST
```

**No code changes are needed per affiliate.** Codes are free-form; just
give each distributor a unique one. Valid characters are letters, digits,
hyphen and underscore, up to 64 characters — anything else is ignored.

The code is stored in the visitor's browser (`localStorage`, key
`xny_ref_code`) so it survives them browsing around and checking out. A
later visit *without* `?ref=` keeps the stored code, so a referred customer
who returns via a plain link still counts. A visit *with* a different
`?ref=` replaces it (last referrer wins).

### ⚠️ Manual setup you must do yourself (the feature is inert until you do)
These are Cloudflare dashboard steps — they can't be done from the repo:

1. **Create the KV namespace.** Cloudflare dashboard → **Workers & Pages →
   KV → Create a namespace**, name it `REFERRALS_KV`.
2. **Bind it to this Pages project.** Your Pages project → **Settings →
   Functions → KV namespace bindings → Add binding**. The *Variable name*
   must be exactly **`REFERRALS_KV`** (this is what the code looks for);
   select the namespace you just created.
3. **Set the report password.** Pages project → **Settings → Environment
   variables → Add variable**, name **`ADMIN_REPORT_PASSWORD`**, value =
   a password of your choosing. Mark it **encrypted / secret**.
4. **Welcome emails only:** set **`RESEND_API_KEY`** the same way (encrypted
   secret), and make sure `xnyfarms.com` is a verified sending domain in
   Resend. See "The welcome email (Resend)" below.
5. **Redeploy** the project so the new bindings take effect.

Until steps 1–3 are done, the endpoints return a clear 503 naming the
missing piece rather than failing silently — so if the report page says
"REFERRALS_KV is not bound", that's the step you've missed. The same goes for
`RESEND_API_KEY`: without it, approving still works but the welcome email
reports that the key is missing.

### Automatic affiliate signup (no admin step)
Ordinary signups need nobody to do anything. In words, the flow is:

1. **Sign up.** The person fills in `affiliate-signup.html` (name, email, phone,
   bank details, optional promotion plan) and ticks the required consent box
   (Privacy Policy and NDPR Notice). The form posts only to
   `/api/submit-affiliate-application`; it no longer opens an email app.
2. **Checks, in order, before anything is stored or emailed:** the hidden
   honeypot field (a bot that fills it is answered "success" and ignored); a
   per-IP attempt limit; field validation and strict length limits; Cloudflare
   Turnstile (if configured); then **duplicate detection** (below); then the
   per-IP signup limit and a per-email limit on confirmation emails.
3. **Unconfirmed record.** The signup is stored as `application:{ts}-{id}` with
   status `unconfirmed` and `expirationTtl` 48 hours, together with
   `idx:email:{normalised}`, `idx:phone:{normalised}` and `verify:{token}` (a
   random 32-byte token), all with the same 48-hour life. A "Confirm your email"
   message (one white-on-dark-green button, plain-text alternative) is sent
   through Resend to the address they typed. If that email can't be sent,
   everything above is rolled back so they can simply try again.
4. **Confirmation.** The button opens `/api/verify-affiliate?token=…`. The
   first valid visit generates a unique code, writes `affiliate:{CODE}`
   (`status: "active"`, `source: "self-signup"`, `email_verified_at`, linked to
   the application), makes the application and idx keys permanent (the TTL is
   removed), sends the standard welcome email and a short "New affiliate: name,
   code" notice to `xnyfarms@gmail.com`, and redirects to
   `affiliate-confirmed.html?status=ok&code=CODE`, which shows the code, the
   personal link (with a copy button) and the stats link. **It is idempotent:**
   mail scanners prefetch links, so opening it again creates nothing and sends
   nothing; it just shows the same result. Unknown or expired tokens go to
   `?status=expired` ("link expired, sign up again"), malformed ones to
   `?status=invalid`.

**Duplicate detection** (server side). Emails are normalised (trimmed,
lower-cased, any `+tag` removed; for `gmail.com`/`googlemail.com` the dots are
removed and `googlemail.com` is treated as `gmail.com`). Phones are normalised
(spaces, dashes, dots, brackets and a leading `+` removed; Nigerian `0XXXXXXXXXX`
becomes `234XXXXXXXXXX`; `234…` must be exactly 13 digits; other countries only
with an explicit `+` and 8-15 digits). Both are looked up in the `idx:` keys. A
match with a **confirmed** affiliate is a 409 naming the field ("This email is
already registered", "This phone number is already registered") with a pointer
to "Resend my welcome email". A match with an **unconfirmed** signup still inside
its 48 hours creates no second signup: the answer says a confirmation email was
already sent and offers to resend it (`/api/resend-confirmation`: at most one
resend per 10 minutes per signup, 3 confirmation emails per address per day; it
re-sends the same link to the address stored on the signup). Stale index keys
(an expired signup, a deleted affiliate) never block anyone.

> **KV race window.** KV is eventually consistent and has no compare-and-set.
> The idx keys are written first and read back to confirm they still point at
> this signup, which catches two requests separated by more than KV's
> propagation delay. Two requests for the same email or phone landing at the
> *same instant* in different data centres can each win their own copy, so both
> could get a confirmation email. The damage is bounded (the second to confirm is
> a duplicate that **Rebuild duplicate index** reports as a conflict), and the
> normal case of someone double-clicking Sign Up is covered by the button being
> disabled and by the read-back.

**Referral codes.** Generated server-side from the name, uppercase A-Z only:
the first 3 letters of the first name + the first 4 of the last (`Adebayo
Okafor` -> `ADEOKAF`; short names are padded from the rest of the name). If the
code is already an affiliate, was ever used for sales or payments, or is a
reserved word (`ADMIN`, `XNY`, `XNYFARMS`, `TEST`…), a 2-digit number is appended
and the check repeats. The digits are derived from the signup, so two requests
confirming the same signup at once land on the same code. Codes are never reused.
Existing codes are unchanged.

**Abuse protection** (the endpoint can cause email to be sent): honeypot; 30
attempts and 5 signups per IP per hour (`CF-Connecting-IP`; note that mobile
networks can put many people behind one IP, so raise `RATE` in
`submit-affiliate-application.js` if real users are blocked); 3 confirmation
emails per address per day; strict length limits; Turnstile. Counters are KV
fixed windows, so they are a brake, not an exact quota.

**Turnstile (optional).** Create a widget in the Cloudflare dashboard
(Turnstile -> Add widget, hostname `xnyfarms.com`). Put the **site key** in the one
constant `window.XNY_TURNSTILE_SITE_KEY` near the bottom of `affiliate-signup.html`,
put the **secret key** in the Pages environment variable `TURNSTILE_SECRET_KEY`,
and redeploy. If either is missing, Turnstile is skipped and signups still work
on the other protections; the admin page shows a visible warning when the secret
is missing. With a secret set, a missing or invalid token is rejected, and if
Cloudflare can't be reached the signup fails closed (503) rather than silently
dropping the check.

**Rebuild duplicate index (run once after deploying).** Affiliates registered
before this feature have no idx keys, so they aren't protected from being
registered again. On `admin-approve-affiliate.html`, press **Rebuild duplicate
index**: it builds the keys for every existing affiliate (email from the
record; phone from the linked application, else the most recent application with
the same email) and reports how many were indexed and any two existing
affiliates sharing an email or phone. It never changes an affiliate and is safe
to run again. It makes about two KV writes per affiliate, and Cloudflare caps KV
operations per request, so with several hundred affiliates run it again until it
reports nothing newly indexed. Until then, "Resend my welcome email" still finds
old affiliates by the email in their record.

**Suspending an affiliate.** Affiliate records carry `status` `"active"` or
`"suspended"` (no status = active, so existing affiliates keep working). On the
Approved affiliates list, **Suspend** / **Reactivate** (with a confirmation) flips
it. A suspended code is not credited by the order settlement and `my-stats.html`
shows a neutral "account paused, contact us" message instead of figures.
Nothing is deleted: orders, payments and the balance stay in the referral report,
flagged **suspended**, so commission that is owed is never hidden. The list also
shows each affiliate's source (self-signup or added by admin) and the date their
email was confirmed.

**"Resend my welcome email"** (on `affiliate-signup.html` and `my-stats.html`):
enter the registered email. The server **always** answers "If that email is
registered, we have sent your details", whether or not it is registered, and
sends the email (after responding) only to an *active* affiliate's registered
address, never to an address from the request. Limits: 5 per IP per hour and 3 per
email per day.

**NDPR: unconfirmed signups expire.** Until the email is confirmed, the signup
(including bank details) is kept for 48 hours and then deleted by KV
automatically, together with its idx keys and token. Confirmed affiliates' records
are kept; delete the application records of anyone you no longer pay.

### Approving an affiliate manually (legacy and exceptional cases)
*Ordinary signups no longer come through here (see above). This section and the
pending-applications list are for applications received before automatic signup
existed and for adding someone by hand.* A manual approval is never blocked by a
duplicate, but it adds the idx keys where free and warns if the email or phone
is already registered to someone else.

Go to **`/admin-approve-affiliate.html`** (also unlinked and noindexed), sign
in with the report password, and you'll see any **pending applications** —
each showing the applicant's contact and bank details and their promotion
plan, newest first. **Use This Application** fills their name and email into
the assignment form below; you type the code yourself, since which code to
give is your call.

Assigning a code marks that application `approved`, so it drops off the
pending list and can't be approved twice by accident. You can also approve
someone who never used the form by just typing their details in directly.

(Applications used to reach that list from the signup form's mailto-plus-KV
submission; that form is now the automatic flow above, so the list only holds
older applications.)

Codes are **letters and digits only** and are stored in
upper case, so a link typed as `?ref=adebayo01` credits the same person as
`?ref=ADEBAYO01`.

The tool checks the code isn't already taken (there's a "Check code
availability" button, and the server refuses a duplicate regardless), writes
`affiliate:{CODE}` to KV, and then **emails the affiliate their welcome
message automatically** through Resend — see below.

### The welcome email (Resend)
The welcome email is sent server-side by `functions/api/send-affiliate-email.js`
through [Resend](https://resend.com), from `XNY Farms <affiliates@xnyfarms.com>`.
It's a proper HTML email — their code, a **View My Referral Link** button, a
**Check My Earnings** button, the 8% terms, a signature and a Follow-us-on-X
link — with a plain-text alternative alongside. Replies go to
`xnyfarms@gmail.com`. (It replaced a client-side `mailto:` draft, which Gmail
was flagging as spam for carrying several raw links.)

**Setup** — one thing in the Cloudflare dashboard:
- **`RESEND_API_KEY`** — Pages project → Settings → Environment variables, as
  an encrypted secret. Never put it in this repo. The sending domain
  `xnyfarms.com` must be verified in Resend, or every send fails with a
  "domain is not verified" error (which the admin page shows you verbatim).

**Who can send, and to whom.** The endpoint is password-gated with
`ADMIN_REPORT_PASSWORD` like every other admin endpoint — it sends mail from
your verified domain, so an open one would be a spam relay and would burn the
domain's sender reputation. It also takes only `{ password, code }`: the server
looks the affiliate up in KV and uses the email **on file**, and builds the
links itself from the code. So it can't be pointed at an arbitrary address or
made to carry arbitrary links, and it refuses a code with no `affiliate:{CODE}`
record rather than announcing an approval that doesn't exist. The affiliate's
name came from a public form, so it's HTML-escaped before going into the email.

**If the email fails**, the approval still stands (the affiliate and code are
already saved). The page says so, shows Resend's own error, and offers
**Try Sending Again**. If you call it the instant after approving and KV hasn't
propagated the new record yet, you'll get a "wait a few seconds and try again"
message rather than a guess.

**Manual fallback.** **Resend manually via email client** on the success page
still opens the old plain-text draft in your own mail app — for if Resend is
down, or you'd rather read the message before it goes. It is no longer the
automatic path.

### Resending a welcome email
Below the assignment form, the page lists every **approved affiliate** (name,
code, email, when approved — newest first). **Resend Welcome Email** sends the
same email again to the address on file, with the result shown on that row. It
changes nothing about the affiliate or their code, so it's safe to press
whenever someone says they never received theirs.

The email's images (`assets/email/logo-email.jpg`, `x-icon-white.png`) are
small, purpose-made copies — the site logo is ~900 KB, too heavy to hot-link
from an email, and Gmail strips inline SVG so the X mark has to be a raster.
They're generated by `tools/generate-email-assets.mjs`; re-run it only if the
logo changes. They're served from `xnyfarms.com`, so they only appear in
emails once the site is deployed. (`x-icon.png`, the old black mark, is kept
only so welcome emails already sent — which reference its URL — don't lose
their icon. The current email doesn't use it.)

### Email button colours: white text on a dark fill, or the label is an image
**A text label in the welcome email is always white on a dark fill. Never dark
text on a bright fill.** Gmail's dark mode (notably on Android) rewrites dark
text colours to light on its own, without regard for the button's background,
and nothing in the email can stop it: not inline styles, not `!important`, not
the `color-scheme` meta tags, not `prefers-color-scheme`. A bright fill is left
alone, so its dark label turns into an unreadable pale tint. Brand-yellow fill
with near-black lettering failed on a real Android device, and so did yellow
with brand-green `#06552A` lettering as *text*.

Gmail never alters **images**, so the one yellow button keeps its green lettering
by making the label part of a picture:

- **View My Referral Link**: brand-yellow `#DAD905` pill with `#06552A` lettering,
  drawn into `assets/email/btn-referral-link.png` (240x42, shown at 2x). The real
  label is its `alt` text and the link is the surrounding `<a>`. It looks the same
  in light and dark mode. If a client blocks images, the alt text shows in green
  on the yellow cell, which is the one case Gmail could still lighten.
- **Check My Earnings**: fill `#0B4124`, white text.
- **Follow us on X** pill: fill `#14231A`, white text and white X mark.

Don't put dark *text* on the yellow again. The tests fail if any text button is
not white-on-dark, or if any text sits on a coloured fill. To change the yellow
button's wording or colours, edit `tools/generate-email-assets.mjs`, re-run it
(its header has the command) and commit the new PNG. Other text is dark-on-pale
(white card, cream page, the mint referral-code box); Gmail inverts those
backgrounds and their text together, so they stay readable.

Colours are stated in several places (`bgcolor` plus `background-color` on the
cell, `color ... !important` on both the link and a nested `<span>`) so a client
that ignores one mechanism still honours another. The `color-scheme` /
`supported-color-schemes` meta tags and the `prefers-color-scheme` block are a
backstop only. One side effect: clients that *do* honour `color-scheme: light
dark` (Apple Mail, parts of Outlook) treat the email as dark-mode-aware and stop
auto-darkening it, so there it stays in its light design.
Run the tests with `node tests/send-affiliate-email.test.mjs` (no
dependencies; KV and Resend are mocked). The payout report and receipts have their
own suites: `node tests/referral-report.test.mjs` and
`node tests/payout-receipts.test.mjs` (receipt contents, last-4-only, recipient
taken from KV, failure handling, phone normalisation, the receipt's button
contrast). Pricing has `node tests/pricing-math.test.mjs` (the maths, including the
780 / 700.83 worked check), `node tests/pricing-api.test.mjs` (public privacy,
validation, versioning, revert, history) and `node tests/log-referral-pricing.test.mjs`
(commission fixed at order time, immutability of history, legacy records). Server-side orders have
`node tests/orders.test.mjs` (server pricing ignores the browser, Flutterwave verification with a
mocked API, underpaid/tampered payments, webhook signature, idempotency, self-referral) and
`node tests/security.test.mjs` (admin lockout on every admin endpoint, stats throttle, `_headers`,
no secrets in browser files).
Automatic signup has `node tests/affiliate-signup.test.mjs` (mocked KV
with TTLs, a fake clock, mocked Resend and Turnstile). Browser tests for the
password toggle and the signup pages are in `tests/browser/` and need Playwright:
`NODE_PATH=/path/to/node_modules node tests/browser/run.mjs`. They check what would be sent, not how
Gmail renders it — for that, send a real email to a test affiliate.

### ⚠️ Only approved codes earn commission
Commission is credited only for a **paid, server-verified order** whose referral code is an approved,
non-suspended `affiliate:{CODE}`, and not when the buyer's email or phone matches the affiliate's own
(self-referral). An invented `?ref=` in someone's URL bar earns nothing, and neither does anything
posted to `/api/log-referral` (it now only re-reads a paid order's stored commission; it ignores any code,
amount or items in the request). Orders with an unrecognised or inactive code are still paid normally;
they just credit nobody.

**The practical consequence: assign the code _before_ the affiliate starts
sharing their link.** The code is checked when the order is **paid**; a sale made through a code that
wasn't approved at that moment is not credited and is not recovered afterwards.

### Affiliates checking their own stats
Affiliates can see their own numbers at
**`/my-stats.html?code=THEIRCODE`** — orders, total sales, commission
earned, **paid out**, **balance due** and a list of the **payments sent to them**
(date, amount, reference; newest first; the public endpoint reads at most the
newest 50 references). No password: the page needs only the code, and the endpoint returns
that one code's totals and nothing else (no other affiliate's figures, no
customer details, no order-level data, and **never bank details**, payment
references or notes: it reads only the amounts from the payout records' KV
metadata). The link is included in the welcome
email.

Because it needs no password, anyone who is given or guesses a code can see
that code's totals, including how much has been paid to it. It exposes no
personal data, but if you consider earnings sensitive, issue codes that aren't easy to guess.

### Viewing the report, and paying affiliates
Go to **`/admin-referrals.html`** (e.g. `https://xnyfarms.com/admin-referrals.html`)
and enter the `ADMIN_REPORT_PASSWORD`. You get:

- **Summary cards:** total sales, commission earned, paid out, **balance due**,
  active affiliates and orders.
- **A table, largest balance due first:** affiliate, orders, sales, earned, paid,
  balance due, last order. One row per *approved* affiliate (including those with
  no orders yet), plus any referral code that has orders but no affiliate record,
  flagged **unregistered**. *Balance due* is earned minus paid and is never shown
  below zero; an affiliate paid more than they earned gets an **overpaid** flag
  (the overpayment is shown separately, it does not cancel anyone else's balance).
- **Search** (name, code, email), **Balance due only**, **Hide affiliates with no
  orders**, **Export CSV** and **Print / Save as PDF**.
- **Click a row** to expand it: contact details, where to send the money (bank,
  account holder, account number), the order-by-order list, the payments made so
  far, and a **Record payment** form (amount prefilled with the balance due).

**Paying an affiliate is a manual, two-step job.** The site never moves money.
(1) Send the money yourself (bank transfer, a Flutterwave transfer, cash).
(2) Click **Record payment** in their row, fill in the amount, date and
(optionally) the transfer reference. You are asked to confirm first. A mistaken
entry can be removed with **Remove** next to it (that only deletes the entry in
this report; it does not reverse any money already sent). **Reconcile the orders
against the Flutterwave dashboard before paying**: order records are written by
customers' browsers and are not verified (see the trust warning below).

**Payment receipts by email.** The *Record payment* form has an **"Email a payment
receipt to the affiliate"** box, ticked by default. After the payment is saved,
the affiliate is emailed (through Resend, from `affiliates@xnyfarms.com`, replies
to `xnyfarms@gmail.com`; it needs the same `RESEND_API_KEY` as the welcome email)
a receipt with: this payment (amount, date, reference, note), where they stand
(total commission earned, total paid to date *including this payment*, balance
still due), where it went (**bank name and the last four digits only, never the
full account number**), a white-on-dark-green **View My Earnings** button, a plain
text version, and a line saying to reply if anything looks wrong. Everything is
read from KV on the server: the recipient is the email on the affiliate record, and
the totals are recomputed from the stored orders and payments. Nothing about the
recipient, the totals or the bank comes from the browser.

The **payment is always saved first.** If the email fails (Resend down, domain not
verified, no `RESEND_API_KEY`, bad address on file) the page says *"Payment
recorded, but the email failed: <reason>. You can resend it."* The outcome is
stored on the payment as `notified_email: { at, ok, error }` and shown as a badge
in the payment list: **Emailed <date>**, **Email failed** (hover for the reason) or
**Not emailed** (older payments, or the box was unticked). **Send / Resend
receipt** emails it again (the totals in a resent receipt are the current ones).
Removing a payment sends nothing.

**WhatsApp and SMS buttons (manual, free).** Each payment also has **WhatsApp** and
**SMS** buttons that open a ready-written message (`https://wa.me/<number>?text=…`
and an `sms:` link) for *you* to press send on:

> Hello Adebayo, XNY Farms has paid ₦1,500 commission to your GTBank account ending
> 4821 on 10 May 2026. Ref: FLW-1. Total paid to date: ₦2,000. Balance due: ₦2,800.
> Check your earnings: https://xnyfarms.com/my-stats.html?code=ADEBAYO01 Thank you
> for partnering with us.

They are manual on purpose: sending WhatsApp or SMS automatically needs a paid API
(WhatsApp Business API with approved message templates, or an SMS gateway with a
registered sender ID, and Nigerian SMS rules to comply with), which is cost and
set-up this site doesn't need. A `wa.me` link is free and uses your own WhatsApp.
SMS opens your phone's messaging app, so it works on a phone but not on most
desktops. The message text is built on the server (so the totals match the
receipt) and there is deliberately no full stop after the link, because chat apps
would include it in the URL. The phone number is the one on the affiliate's
signup application; it is normalised (spaces, dashes, brackets and a leading `+`
removed; `0801…` becomes `234801…`; anything that isn't an 11-digit `0…` or
13-digit `234…` number is invalid) and, if invalid or missing, the buttons are
greyed out with "No valid phone number on file".

**Bank details (NDPR).** Account numbers are shown masked (`******4821`) until
you press **Reveal**; **Copy account number** copies the full number regardless.
They are never written to the console or put in a URL. The CSV export contains
full account numbers (and a warning says so): store it securely and delete it
once the payments are made. Under the NDPR you should keep bank details only as
long as you need them, and delete the application records (see below) for
affiliates you no longer pay. **Receipts carry payment data too:** the amount,
the date, the reference and note, the running totals, and the bank name with the
last four digits are emailed to the affiliate and stay in their mailbox and in
Resend's sending logs (check Resend's retention settings). Only the last four
digits are ever sent, and the same goes for the WhatsApp/SMS text, but treat
payment references and notes as personal data and don't put anything in them you
wouldn't want in an email. In the CSV, account and phone numbers are written
as `="0123456789"` so Excel and Google Sheets keep the leading zero; other
spreadsheet programs may show the `="..."` wrapper.

**How an affiliate is matched to their bank details.** Approving someone from the
pending-applications list stores that application's key on the affiliate record
(`application_key`). Affiliates approved before that existed have none, so the
report falls back to the **most recent application with the same email address**
(case-insensitive). If neither exists the row says *No payout details on file*.
That email fallback reads the stored applications (the newest 500, once per
report load, only when some affiliate needs it); affiliates with a key cost one
read each. Per-order detail is only loaded for the row you expand.

The page is deliberately **not linked from any public nav or menu**: bookmark it.
It carries a `noindex, nofollow` meta tag and an `X-Robots-Tag` header (see
`_headers`) so search engines skip it. Note that this is *obscurity plus a
password*, not real access control: anyone who learns the URL still needs
the password, so use a strong one.

### How it works
| Piece | What it does |
| --- | --- |
| `js/referral.js` | Loaded on every page. Captures `?ref=` and stores it. (It no longer reports sales: the server credits commission from verified orders.) |
| `functions/api/create-order.js` | Pages Function. Public. Prices the cart on the server and stores a pending `order:{tx_ref}`; replies with the `tx_ref` and amount to charge. Rate limited. |
| `functions/api/verify-order.js` | Pages Function. Public. Confirms an order with Flutterwave (server to server) and settles it; replies `paid`/`pending`/`underpaid`/... only. |
| `functions/api/flutterwave-webhook.js` | Pages Function. Flutterwave's `verif-hash`-signed webhook; re-verifies the payment, then settles the order. |
| `functions/_lib/orders.js`, `referrals.js`, `admin-auth.js` | Order creation/settlement; commission crediting from a paid order; the admin password check with brute-force lockout. |
| `functions/api/log-referral.js` | Legacy. Takes only a `tx_ref`; for a **paid** order it re-writes the commission fixed at order time. Cannot create sales. |
| `functions/api/get-referrals.js` | Pages Function. Password-checked payout report: per affiliate and in total, earned / paid / balance due plus payout details. With `{ "code": ... }` it returns that one affiliate's orders and payments. |
| `functions/api/record-payout.js` | Pages Function. Password-checked; records a payment made to an affiliate (`payout:{CODE}:...`) and optionally emails the receipt (`email_receipt: true`); `{ payout_key }` resends a receipt; `{ delete_key }` removes a payment. Only `payout:` keys are accepted for both. |
| `functions/_lib/*.js` | Shared code imported by the functions (no `onRequest*` export, so Pages doesn't route them): `email.js` (Resend sender, buttons, signature), `payouts.js` (KV readers, kobo maths, phone normalisation, message text), `receipt.js` (the receipt email). |
| `functions/api/register-affiliate.js` | Pages Function. Password-checked code assignment; writes `affiliate:{CODE}` and marks the linked application approved. |
| `functions/api/send-affiliate-email.js` | Pages Function. Password-checked; emails an approved affiliate their welcome message via Resend. |
| `functions/api/get-affiliates.js` | Pages Function. Password-checked; lists approved affiliates for the resend list. |
| `functions/api/submit-affiliate-application.js` | Pages Function. Public self-service signup: honeypot, rate limits, validation, Turnstile, duplicate detection, stores an UNCONFIRMED `application:{ts}-{id}` (48h TTL) + idx keys + `verify:{token}` and emails the confirmation link. |
| `functions/api/verify-affiliate.js` | Pages Function. Public GET from the confirmation email; idempotently creates the affiliate, sends the welcome email and the admin notice, redirects to `affiliate-confirmed.html`. |
| `functions/api/resend-confirmation.js` | Pages Function. Public; re-sends a pending signup's confirmation email (10-minute cooldown). |
| `functions/api/resend-welcome.js` | Pages Function. Public "Resend my welcome email"; always the same answer, mails only an active affiliate's registered address. |
| `functions/api/rebuild-index.js` | Pages Function. Password-checked; one-time duplicate-index build for existing affiliates, with a conflict report. |
| `functions/api/set-affiliate-status.js` | Pages Function. Password-checked; suspend / reactivate an affiliate. |
| `functions/api/get-pending-applications.js` | Pages Function. Password-checked; lists applications still pending, newest first. |
| `functions/api/get-my-stats.js` | Pages Function. Public, returns one code's own totals only (orders, sales, earned, paid, balance due; never bank details). |
| `admin-referrals.html` + `js/admin-referrals.js` | The referral & payout report page. |
| `admin-approve-affiliate.html` + `js/admin-approve-affiliate.js` | Approve an affiliate, assign their code, send/resend their welcome email. |
| `my-stats.html` + `js/my-stats.js` | Affiliate self-check page. |
| `affiliate-signup.html` + `js/affiliate-signup.js`, `js/resend-welcome.js` | The public signup form (and "Resend my welcome email"). |
| `affiliate-confirmed.html` + `js/affiliate-confirmed.js` | Where the confirmation link lands: shows the code and link, or a friendly expired/invalid message. |
| `js/password-toggle.js` | Show/hide eye button added to every `input[type="password"]` (see below). |

KV keys used: `affiliate:{CODE}` (one per approved affiliate; value
`{name, email, approved_at, application_key?}`, metadata `{n, e, at, k?}`),
`referral:{CODE}:{tx_ref}` (one per recorded sale; metadata `{c, t, m, ts}`),
`payout:{CODE}:{timestamp}-{id}` (one per payment made to an affiliate; value
`{code, amount_ngn, paid_on, reference, note, recorded_at}`, metadata
`{c, a, ts}` so totals come from `list()` alone; `notified_email:
{at, ok, error}` is added to the value, never the metadata, once a receipt has
been tried) and
`application:{timestamp}-{id}` (one per signup application, holding bank
details and phone), plus the self-signup keys: `idx:email:{normalised}` and
`idx:phone:{normalised}` (who owns that email/phone: `{type:"signup",id}` or
`{type:"affiliate",code}`), `verify:{token}` (confirmation tokens; 48h until used,
then 90 days) and `rl:*` (rate-limit counters). Unconfirmed `application:`,
`idx:` and `verify:` keys carry a 48-hour TTL.

### ⚠️ Applications hold personal data
Signups store **bank details** in KV (and the payout report reads them from
there). `/api/submit-affiliate-application` is public, so it is protected by
the honeypot, rate limits and (optionally) Turnstile; see *Automatic affiliate
signup*. Under the NDPR those account numbers are personal data you're
responsible for: unconfirmed signups delete themselves after 48 hours, but
confirmed ones stay until you remove them, so keep them only as long as you need
them and delete the applications of anyone you no longer pay.

### Password fields: show/hide eye
Every `input[type="password"]` gets an eye button inside its right edge
(`js/password-toggle.js`): a real `<button type="button">` with `aria-label`
"Show password" / "Hide password", `aria-pressed`, a 44px touch target and a
visible focus ring. It toggles the input between `password` and `text`, keeps the
caret where it was, never submits the form, and goes back to hidden when the form
is submitted or the field is cleared. The admin pages load the script directly;
`js/main.js` injects it on any other page the moment a password input exists
(including one added later), so a future password field is covered
automatically, as long as the page loads `main.js` (or the script itself).

Records are keyed by `tx_ref`, so a retry, a webhook replay or a page refresh rewrites the
same record instead of double-counting a sale.

### Commission and the money
Commission is recorded only from orders Flutterwave has confirmed, so the old "reconcile every
`tx_ref` before paying" warning no longer applies. It is still sensible to glance at Flutterwave
before a large payout. Affiliates' `my-stats.html` totals are visible to anyone who knows the code
(see *Affiliates checking their own stats*).

---

## 8. Security

### Could a customer pay less by editing the price in their browser?
They could in the earlier design, and that is what this section fixes. Before, the browser decided the
amount sent to Flutterwave, "paid" was trusted from a client-side callback, and anyone could POST a
fabricated sale to the referral endpoint. Now:

| Attack | What happens |
| --- | --- |
| Edit prices, totals, delivery or the commission rate in the browser or in the request | Ignored. `/api/create-order` takes only product ids and quantities and prices them from the server's pricing config. |
| Edit the amount inside Flutterwave's payment window | Flutterwave takes the lower amount, but the server compares it with the order total: the order is **underpaid**, never marked paid, no commission, and you get an **ALERT** email. |
| Claim "payment successful" without paying | The server asks Flutterwave itself (secret key). A claim from the browser is never believed. |
| Pay in another currency, or reuse another payment's reference | Currency must be `NGN`, the `tx_ref` must match and the amount must cover the total. |
| Invent a sale for an affiliate (`/api/log-referral`) | It cannot create one: it only re-reads a paid order's stored commission. Commission is credited by the server from verified orders, at the price and rate fixed when the order was created. |
| Buy through your own affiliate link | Not credited when the buyer's email or phone matches the affiliate's. |
| Guess the admin password | 10 wrong attempts per IP in 15 minutes locks that IP out of **every** admin endpoint (429, even with the right password) until the window passes; comparison is constant-time. |
| Walk through affiliate codes on the public stats lookup | 60 lookups per IP per 10 minutes. |
| Flood order creation or verification | 20 orders and 90 verifications per IP per hour. |

Response headers (`_headers`): `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`, **HSTS** (one year), and a partial **Content-Security-Policy**
(`object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'`). The admin pages are
`no-store` and noindex. No script, style or image restriction is set on purpose: Flutterwave's checkout
and Turnstile load third-party scripts, and a strict CSP added blind could break payment. All text the
pages build from data uses `textContent`; the few `innerHTML` uses are fixed strings or escaped values.
Secrets (`FLW_SECRET_KEY`, `FLW_SECRET_HASH`, `RESEND_API_KEY`, `ADMIN_REPORT_PASSWORD`,
`TURNSTILE_SECRET_KEY`) live only in Cloudflare environment variables; `tests/security.test.mjs` fails if
one is named in any browser-served file.

### What is **not** solved (be honest with yourself about these)
- **Amount editing in Flutterwave's window** can still happen on Flutterwave's side; the protection is that
  an underpaid order is detected and never fulfilled. **Check the "New Order" email, not just that someone
  paid, before releasing goods**, and treat an ALERT email as "do not ship".
- The Flutterwave verify call follows their documented response shape but was only tested against a mock.
  Make one small real payment after setting the variables, and confirm you receive the "New Order" email.
- Until `FLW_SECRET_KEY` is set, checkout is **disabled** (503), by design.
- `my-stats.html` is public to anyone who knows an affiliate's code (totals only, no personal data).
- The admin area is protected by one shared password plus, once you switch it on, Cloudflare Access (section 9). Make the password long and unique. The lockout is per IP.
- A full CSP (restricting scripts to known hosts) is a sensible next step once it can be tested against live
  Flutterwave and Turnstile.
- Customer name, email, phone and delivery address are stored on the order in KV (pending orders expire after
  7 days; paid orders are kept). Under the NDPR, delete them when you no longer need them.
- An old cached copy of the checkout page (cached up to 5 minutes) that completes a payment will not have an
  order on the server, so that one sale will not be credited or emailed automatically; check Flutterwave.

### Admin screens
Every admin page has floating **jump to the bottom / back to the top** buttons (`js/admin-scroll.js`). On the
pricing page a **sticky bar** stays at the bottom of the screen showing "N unsaved changes", with **Next
change**, **Discard** and **Review & save**. Review & save opens over the page (no scrolling): it lists exactly
what will change, shows a warning you must tick if any price is below the recommendation, takes the note, and
saves. The browser also warns before you leave the page with unsaved edits.

---

## 9. Admin protection: Cloudflare Access, the password, and the audit log

Three layers guard the admin pages and the admin APIs (`admin-pricing`, `get-affiliates`,
`get-pending-applications`, `get-referrals`, `rebuild-index`, `record-payout`, `register-affiliate`,
`send-affiliate-email`, `set-affiliate-status`, plus `admin-status` and `get-audit-log`):

1. **Cloudflare Access** (outer door). An Access application puts a login (your email, a one-time code or your
   identity provider) in front of the admin pages and APIs. Cloudflare then adds a signed token, the
   `Cf-Access-Jwt-Assertion` header, to every request that gets through.
2. **The server checks that token** (`functions/_lib/admin-auth.js`), so it still works if someone reaches the
   API some other way (the `*.pages.dev` address, a script). RS256 only (`none`, HS256 and everything else are
   refused), signature checked against Cloudflare's published keys (cached 10 minutes; one refetch on an unknown key
   id, at most every 30 seconds), `iss`, `aud`, `exp` and `nbf` (30 seconds of clock leeway) and an `email` claim.
   A token with no email (a service token) is not accepted as an admin.
3. **The admin password**, with the existing lockout (10 wrong attempts per IP in 15 minutes).

When Access is enforced, a request needs **both** a valid token and the password. The token is checked first, so a
caller outside Access gets `403` and can't even use the password lockout.

### Environment variables (Pages -> Settings -> Environment variables)

| Variable | Value |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Your Zero Trust team domain, e.g. `yourteam.cloudflareaccess.com` (Zero Trust -> Settings -> General). |
| `CF_ACCESS_AUD` | The **Application Audience (AUD) tag** of the Access application you create below. |
| `ACCESS_ENFORCE` | `true` to require Access. **Exactly `true`**: anything else (empty, `True`, `1`, `false`, unset) means not enforced. Never inferred from the hostname. |

If `ACCESS_ENFORCE` is `true` but the team domain or audience is missing or invalid, the keys can't be fetched, or the
token is missing or bad, every admin endpoint answers **403** (it fails closed). When it is not `true`, nothing changes
for you, except that a valid token, if one is present, is still verified and used: its email goes into the audit log.

### Setting up the Access application

Zero Trust -> Access -> Applications -> Add -> Self-hosted, with an Allow policy for the people who may use the admin
tools (specific emails). Add these as the application's destinations on `xnyfarms.com`:

```
/admin.html  /admin-referrals.html  /admin-pricing.html  /admin-approve-affiliate.html
/api/admin-pricing  /api/admin-status  /api/get-affiliates  /api/get-pending-applications  /api/get-referrals
/api/get-audit-log  /api/rebuild-index  /api/record-payout  /api/register-affiliate
/api/send-affiliate-email  /api/set-affiliate-status
```

**Do not protect `/api/*` as a whole or the whole site.** These must stay open to everyone, with no Access login:
`create-order`, `verify-order`, `flutterwave-webhook` (Flutterwave can't log in), `pricing`, `log-referral`,
`get-my-stats`, `submit-affiliate-application`, `verify-affiliate`, `resend-confirmation`, `resend-welcome`. Their
tests run with enforcement on and no token (`tests/admin-access.test.mjs`).

Set `ACCESS_ENFORCE` for the **Production** environment only. A preview deployment on another hostname isn't covered
by the Access application, so enforcing there would just lock you out of the admin tools on previews.

### Rolling it out safely

1. **Deploy** this code. `ACCESS_ENFORCE` is unset, so nothing changes. The admin pages show an amber banner
   "Cloudflare Access is not enforced".
2. **Create the Access application and set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`**, then redeploy. Still not
   enforced. Open an admin page (you now pass through the Access login first), sign in, and read the banner: it should say
   "You are signed in through Access as <your email>, but the server does not require it yet". That proves the
   token is being verified. Make a harmless change (or look at the activity log) and check your email is recorded.
3. **Set `ACCESS_ENFORCE` to `true` and redeploy.** The banner turns green: "Protected by Cloudflare Access as <you>".
4. **Test the closed door.** From a private window or `curl`, `POST https://xnyfarms.com/api/get-referrals` with the
   right password and no Access login must not return data. Then check the public site still works: browse, add to
   cart, and start a checkout.

### Break-glass: Access is down, or you are locked out

Set `ACCESS_ENFORCE` to anything other than `true` (or delete it) and **redeploy**: the admin tools go back to
password-only, with the lockout still in force. Nothing else needs to change. During a Cloudflare Access outage the
admin endpoints answer 403 (they fail closed); the public site, checkout and webhook are unaffected. Turn
enforcement back on once Access is healthy.

### Session expiry

If the Access session lapses while an admin page is open, the next request is redirected to the Access login (or
returns a page that isn't JSON). The admin pages catch that and show **"Your session expired. Reload this page to
sign in again."** instead of a JSON error. An unsaved pricing edit stays on screen until you reload.

### The activity log (audit trail)

Every sensitive admin action writes `audit:{ISO time}-{id}` to KV: `{ at, actor_email, actor_ip, action, summary }`,
kept for **400 days**. `actor_email` is the verified Access email, or `password-only`. Recorded: pricing save and
revert, payout recorded / deleted / receipt resent, affiliate registered / suspended / reactivated, welcome email
resent, index rebuild, and admin lockouts (once per lockout). Payout records now carry `recorded_by` and pricing
versions `changed_by` (admin only; the public pricing API never shows them). It is shown on **`admin.html`** under
*Activity log* (newest 200), read from `/api/get-audit-log`.

A summary is plain words built from safe values: amounts, codes, affiliate names, version numbers. It never contains
a password, a wrong guess, an account number, a payout reference or note, an affiliate's email or phone, a token or a
request body (the tests check this). Writing an entry is best effort: if KV hiccups, the action still goes through.

### Headers on admin pages and APIs

The four admin pages get `Cache-Control: no-store`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`,
`Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and the existing noindex, via `_headers` (the `!` lines
detach the site-wide values first, because Cloudflare joins duplicate headers with a comma). The admin **API** responses
get the same set from `functions/api/_middleware.js`, since `_headers` is not applied to Functions responses.

Run the tests with `node tests/admin-access.test.mjs` (real RSA signatures with a mocked keys endpoint) and the
browser suite for the banner, the expired-session message and the activity log.
