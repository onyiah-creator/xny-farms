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
- [x] **Working B2B checkout portal** — `cart.html` provides a full cart +
      Flutterwave Inline Checkout flow (see Section 5 below). Add your
      Flutterwave **public** key to `js/checkout.js` before this satisfies a
      KYC reviewer asking to see a live payment flow.

Placeholders left in `[BRACKETS]` will be visible to a reviewer — do not submit
until the checklist above is complete.

---

## 5. Cart, Checkout & Payments (Flutterwave)

`cart.html` implements a client-side cart + checkout using **Flutterwave's
Inline Checkout JS SDK**, entirely from the browser — there is no backend,
consistent with the rest of this static site.

### How it works
- **Cart storage:** `js/cart.js` keeps cart contents (product id, name, size,
  unit price, quantity) in `localStorage` under the key `xny_cart`, and drives
  the header cart icon/badge that appears on all 9 pages plus `cart.html`.
  The product catalog (id → name/size/price/image) lives at the top of that
  file — keep it in sync with the prices shown on `products.html` /
  `index.html`.
- **"Add to Cart" buttons** on `products.html` and the homepage featured cards
  (ASHE Honey, Palm Oil) use a `data-add-to-cart="<product-id>"` attribute;
  `js/cart.js` wires them up automatically. "Enquire to Order" was removed
  from these retail product cards now that a real checkout exists — bulk /
  wholesale buyers are still served separately via the dedicated
  **Wholesale Enquiry** flow (nav + `wholesale.html`), linked from a note
  under each product section on `products.html`.
- **Delivery fee:** `cart.html` offers a Lagos / Other Nigerian States choice.
  The flat rates are constants at the top of `js/checkout.js`:
  ```js
  var DELIVERY_RATE_LAGOS = 1500; // NGN — placeholder, update once a courier partner is confirmed
  var DELIVERY_RATE_OTHER = 3500; // NGN — placeholder, update once a courier partner is confirmed
  ```
  These are provisional flat rates — update them (and only them) once a real
  courier partner and zone pricing are confirmed.
- **Checkout:** after "Proceed to Checkout", the visitor enters name, email,
  phone and delivery address, then "Pay Now" opens Flutterwave's Inline
  Checkout modal for the calculated total (subtotal + delivery) in NGN, with
  a generated `tx_ref` (`xny-<timestamp>`).

### ⚠️ You must add your Flutterwave public key
`js/checkout.js` ships with a placeholder:
```js
var FLUTTERWAVE_PUBLIC_KEY = "YOUR_FLUTTERWAVE_PUBLIC_KEY_HERE";
```
Replace this with your real **public** key from the Flutterwave dashboard.
Until you do, "Pay Now" shows a friendly "online payment isn't configured
yet" message instead of trying to open the checkout modal — the site stays
functional, it just won't take real payments.

### Order notification — read this
This is a static site with **no backend or webhook**, so XNY Farms is **not**
automatically notified when a payment succeeds. To close that gap, a
successful Flutterwave callback automatically also opens a pre-filled
`mailto:` link (same pattern as the contact/wholesale forms) addressed to
`xnyfarms@gmail.com` with the order details and the Flutterwave `tx_ref`. The
on-page confirmation also shows a **"Resend Confirmation Email"** button in
case the visitor's browser didn't open their email client, or they closed the
tab before it fired.

**The mailto notification is a convenience, not the source of truth.** A
customer could close their browser before it fires. The real record of
whether a payment actually succeeded is always the **Flutterwave merchant
dashboard** (**dashboard.flutterwave.com**) — check it there before
dispatching any order, don't rely solely on receiving the confirmation email.

### Security — secret key & fraud protection
- The Flutterwave **secret key must never** be added to this repository or
  any client-side code (`js/checkout.js` or otherwise). It is only ever
  meant to be used **server-side**, which this static-site MVP does not
  implement.
- **Known limitation:** payment success here is currently trusted from the
  client-side Flutterwave callback alone — it is **not server-verified**.
  That's enough to accept real payments and get notified today, but for full
  fraud protection you should eventually add a small **Cloudflare Pages
  Function** that calls Flutterwave's **Verify Transaction API** with the
  secret key, server-side, before treating an order as confirmed. This is a
  recommended fast-follow, not a blocker for launching checkout today.

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

### Adding a new product
1. Add it to `PRODUCTS` in `js/cart.js`.
2. Add its title/description to `OG_PRODUCTS` in `functions/_middleware.js`.
3. Re-run `node tools/generate-og-images.mjs`.
4. Give its card an `id` on `products.html` and a `data-share-product` button.

---

## 7. Referral / affiliate programme

Distributors and affiliates get a referral link. When someone arrives via
that link and completes a purchase, the order is logged against their code
and **8% of the order subtotal** (delivery fees excluded) is recorded as
commission owed.

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
4. **Redeploy** the project so the new bindings take effect.

Until steps 1–3 are done, the endpoints return a clear 503 naming the
missing piece rather than failing silently — so if the report page says
"REFERRALS_KV is not bound", that's the step you've missed.

### Approving an affiliate (assigning their code)
Go to **`/admin-approve-affiliate.html`** (also unlinked and noindexed), sign
in with the report password, and you'll see any **pending applications** —
each showing the applicant's contact and bank details and their promotion
plan, newest first. **Use This Application** fills their name and email into
the assignment form below; you type the code yourself, since which code to
give is your call.

Assigning a code marks that application `approved`, so it drops off the
pending list and can't be approved twice by accident. You can also approve
someone who never used the form by just typing their details in directly.

Applications reach that list because the public signup form saves to KV as
well as opening its mailto: — you still get the email, and now there's a
durable record behind it. Saving is fire-and-forget: if it fails the
applicant still gets their email opened as normal and sees no error, so
check the pending list against your inbox occasionally.

Codes are **letters and digits only** and are stored in
upper case, so a link typed as `?ref=adebayo01` credits the same person as
`?ref=ADEBAYO01`.

The tool checks the code isn't already taken (there's a "Check code
availability" button, and the server refuses a duplicate regardless), writes
`affiliate:{CODE}` to KV, then **opens a pre-filled welcome email** in your
own mail client containing their code, their referral link, a link to their
stats page and a reminder of the 8% rate.

**You still press send.** Nothing is emailed automatically — this project has
no transactional email service. A future upgrade could send it for real via
an email API such as [Resend](https://resend.com) or
[SendGrid](https://sendgrid.com); that would need its own API key stored as a
Pages secret, and is not required for any of this to work today.

### ⚠️ Only approved codes earn commission
`/api/log-referral` records a sale **only if `affiliate:{CODE}` exists** — so
an invented `?ref=` in someone's URL bar can't manufacture commission. An
unrecognised code is ignored silently: the customer sees nothing either way,
and their checkout is unaffected.

**The practical consequence: assign the code _before_ the affiliate starts
sharing their link.** Sales made through a code that hasn't been approved yet
are not recorded and cannot be recovered afterwards.

### Affiliates checking their own stats
Affiliates can see their own numbers at
**`/my-stats.html?code=THEIRCODE`** — orders, total sales and commission
earned. No password: the page needs only the code, and the endpoint returns
that one code's totals and nothing else (no other affiliate's figures, no
customer details, no order-level data). The link is included in the welcome
email.

Because it needs no password, anyone who is given or guesses a code can see
that code's totals. It exposes no personal data, but if you consider earnings
sensitive, issue codes that aren't easy to guess.

### Viewing the report
Go to **`/admin-referrals.html`** (e.g. `https://xnyfarms.com/admin-referrals.html`)
and enter the `ADMIN_REPORT_PASSWORD`. You'll get a table of
**Code | Number of Orders | Total Sales | Commission Owed**.

The page is deliberately **not linked from any nav or menu** — bookmark it.
It carries a `noindex, nofollow` meta tag and an `X-Robots-Tag` header (see
`_headers`) so search engines skip it. Note that this is *obscurity plus a
password*, not real access control — anyone who learns the URL still needs
the password, so use a strong one.

### How it works
| Piece | What it does |
| --- | --- |
| `js/referral.js` | Loaded on every page. Captures `?ref=`, stores it, and POSTs completed orders to the logging endpoint. |
| `functions/api/log-referral.js` | Pages Function. Validates the payload, **checks the code is an approved affiliate**, computes 8% commission, writes to KV as `referral:{CODE}:{tx_ref}`. |
| `functions/api/get-referrals.js` | Pages Function. Password-checks, then aggregates all KV records by code. |
| `functions/api/register-affiliate.js` | Pages Function. Password-checked code assignment; writes `affiliate:{CODE}` and marks the linked application approved. |
| `functions/api/submit-affiliate-application.js` | Pages Function. Public; stores a signup application as `application:{timestamp}-{id}` with status `pending`. |
| `functions/api/get-pending-applications.js` | Pages Function. Password-checked; lists applications still pending, newest first. |
| `functions/api/get-my-stats.js` | Pages Function. Public, returns one code's own totals only. |
| `admin-referrals.html` + `js/admin-referrals.js` | The report page. |
| `admin-approve-affiliate.html` + `js/admin-approve-affiliate.js` | Approve an affiliate and assign their code. |
| `my-stats.html` + `js/my-stats.js` | Affiliate self-check page. |
| `affiliate-signup.html` | Public application form (mailto:, reviewed by hand). |

KV keys used: `affiliate:{CODE}` (one per approved affiliate),
`referral:{CODE}:{tx_ref}` (one per recorded sale) and
`application:{timestamp}-{id}` (one per signup application).

### ⚠️ Applications hold personal data
The signup form stores **bank details** in KV, not just in your inbox. Two
things follow. First, `/api/submit-affiliate-application` is public and has
no captcha or rate limiting — anyone who finds the URL can post junk into
the pending list; if that becomes a problem, Cloudflare Turnstile is the
natural fix. Second, under the NDPR those account numbers are personal data
you're responsible for: keep them only as long as you need them, and delete
applications you've finished with. The pending list is password-gated, but
the records themselves stay in KV until you remove them.

Logging happens **after** the customer's payment confirmation is already on
screen, is never awaited, and fails silently (console only) — a logging
outage can never delay or break a real checkout.

Records are keyed by `tx_ref`, so a retry or a page refresh rewrites the
same record instead of double-counting a sale.

### ⚠️ Trust: verify before you pay commission
`/api/log-referral` is public and unauthenticated, and it trusts the order
amount the browser sends it. That's the same trust boundary the checkout
already has (payment success comes from Flutterwave's client-side callback
and isn't server-verified — see Section 5). In practice that means someone
who discovers the endpoint could POST fabricated sales.

**Reconcile each `tx_ref` against your Flutterwave dashboard before paying
out.** The proper fix is the same fast-follow recommended in Section 5:
verify the transaction server-side with Flutterwave's Verify Transaction
API using the secret key, and record only what that call confirms.
