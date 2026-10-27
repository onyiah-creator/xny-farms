export default async function ({ browser, harness, base, check, shots }) {
  const PW = "admin-pw";
  const newCtx = (w = 1280, h = 900, extra = {}) => browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 700, hasTouch: w < 700, ...extra });
  const api = await browser.newContext(); const A = api.request;
  const adminApi = async (body) => (await A.post(base + "/api/admin-pricing", { data: { password: PW, ...body } })).json();
  const publicPrices = async () => (await A.get(base + "/api/pricing", { headers: { "cache-control": "no-cache" } })).json();
  const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, " ").trim();
  const card = (page, id) => page.locator(`#pr-products .pr-card:has(h3:has-text("${id}"))`);

  /* ================= the admin page ================= */
  for (const [label, w, h] of [["desktop", 1280, 1000], ["phone 375px", 375, 800]]) {
    console.log(`-- admin-pricing.html, ${label}`);
    const ctx = await newCtx(w, h);
    const page = await ctx.newPage();
    const dialogs = []; let acceptNext = true;
    page.on("dialog", (d) => { dialogs.push(d.message()); acceptNext ? d.accept() : d.dismiss(); });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/admin-pricing.html");
    check("the page is noindex and has the show/hide eye on its password field", (await page.getAttribute('meta[name="robots"]', "content")).includes("noindex") && (await page.locator("#pr-password").evaluate((i) => i.closest(".pw-field") !== null)));
    await page.fill("#pr-password", "wrong"); await page.click("#pr-signin");
    await page.waitForFunction(() => /Incorrect/.test(document.getElementById("pr-gate-status").textContent));
    check("a wrong password is refused and nothing is shown", await page.locator("#pr-main").isHidden());
    await page.fill("#pr-password", PW); await page.click("#pr-signin");
    await page.waitForSelector("#pr-main:not([hidden])");
    const base0 = (await adminApi({ action: "get" })).config.version;
    check("the editor opens at the live version", new RegExp(`Version ${base0} is live`).test(await text(page, "#pr-version-line")));
    check("four product cards and two delivery cards", (await page.locator("#pr-products .pr-card").count()) === 4 && (await page.locator("#pr-delivery .pr-card").count()) === 2);
    check("rates are shown as percentages (8 and 2.15)", (await page.inputValue("#pr-commission")) === "8" && (await page.inputValue("#pr-fee")) === "2.15");

    // the worked example, live
    const palm = card(page, "Palm Oil — 50cl");
    const inputs = palm.locator("input");           // target, other, price
    await inputs.nth(0).fill("700");
    check("target net 700 -> recommended price 780 (exact minimum 779.08)", /Recommended price: ₦780/.test(await text(page, `#pr-products .pr-card:has(h3:has-text("Palm Oil — 50cl")) .pr-rec`)) && /779\.08/.test(await palm.locator(".pr-rec").textContent()));
    await palm.locator("button:has-text('Use recommended')").click();
    check("'Use recommended' fills the price with 780", (await inputs.nth(2).inputValue()) === "780");
    const dl = await palm.locator(".pr-break").textContent();
    check("at 780: commission ₦62.40, processor fee ₦16.77, you keep ₦700.83", /₦62\.40/.test(dl) && /₦16\.77/.test(dl) && /₦700\.83/.test(dl), dl);
    check("a green status says the target is met", (await palm.locator(".pr-status").getAttribute("class")).includes("pr-status--ok") && /meeting your target/.test(await palm.locator(".pr-status").textContent()));
    await inputs.nth(2).fill("750");
    const bad = await palm.locator(".pr-status").textContent();
    check("typing 750 shows a RED warning in plain words: keep ₦673.88 instead of ₦700, short by ₦26.12", (await palm.locator(".pr-status").getAttribute("class")).includes("pr-status--bad") && /You keep ₦673\.88 instead of ₦700, short by ₦26\.12/.test(bad), bad);
    check("the warning is visibly red", (await palm.locator(".pr-status").evaluate((e) => getComputedStyle(e).color)) === "rgb(143, 45, 32)");
    await inputs.nth(2).fill("10");
    check("a price that loses money says so", /You lose ₦\d/.test(await palm.locator(".pr-status").textContent()) || /short by/.test(await palm.locator(".pr-status").textContent()));
    await inputs.nth(2).fill("780");

    // other cost absorbed
    await inputs.nth(1).fill("50");
    check("an absorbed other cost of ₦50 raises the recommendation (700 + 50 -> 840)", /Recommended price: ₦840/.test(await palm.locator(".pr-rec").textContent()));
    await inputs.nth(1).fill("0");

    // bad rates
    await page.fill("#pr-commission", "60");
    check("a commission over 50% shows an error and removes the recommendation", /between 0% and 50%/.test(await text(page, "#pr-rate-error")) && await palm.locator("button:has-text('Use recommended')").isDisabled());
    await page.fill("#pr-commission", "50"); await page.fill("#pr-fee", "40");
    check("commission + fee of 90% is refused", /under 90%/.test(await text(page, "#pr-rate-error")));
    await page.fill("#pr-commission", "8"); await page.fill("#pr-fee", "2.15");
    check("fixing the rates clears the error", (await text(page, "#pr-rate-error")) === "");

    // delivery
    const lagos = page.locator("#pr-delivery .pr-card").nth(0);
    check("Lagos: calculated charge 1,540 (courier cost 1,500 passed through the fee)", /Calculated charge: ₦1,540/.test(await lagos.locator(".pr-rec").textContent()));
    check("the saved charge of 1,500 is flagged: you pay ₦32.25 of the delivery yourself", /you pay ₦32\.25/.test(await lagos.locator(".pr-status").textContent()) && (await lagos.locator(".pr-status").getAttribute("class")).includes("pr-status--bad"), await lagos.locator(".pr-status").textContent());
    await lagos.locator("button:has-text('Use calculated charge')").click();
    check("'Use calculated charge' sets 1,540 and the status turns green with ₦6.89 to spare", (await lagos.locator("input").nth(1).inputValue()) === "1540" && /₦6\.89 to spare/.test(await lagos.locator(".pr-status").textContent()));
    await page.uncheck("#pr-passfee");
    check("with the fee absorbed the calculated charge equals the courier cost", /Calculated charge: ₦1,500/.test(await lagos.locator(".pr-rec").textContent()) && /absorbed/.test(await lagos.locator(".pr-rec").textContent()));
    await page.check("#pr-passfee");
    await lagos.locator("input").nth(1).fill("1600");
    check("a manual override shows its effect on what reaches the courier", /Left after the fee/.test(await lagos.locator(".pr-break").textContent()) && /₦1,565\.60/.test(await lagos.locator(".pr-break").textContent()), await lagos.locator(".pr-break").textContent());
    await lagos.locator("input").nth(1).fill("1540");

    // sample order
    const sampleKeep = await page.evaluate(() => {
      const M = window.XNYPricingMath; const r = Number(document.getElementById("pr-commission").value) / 100, f = Number(document.getElementById("pr-fee").value) / 100;
      return M.formatNgn(M.orderPreview({ items: [{ price: 780, qty: 2 }], deliveryCharge: 1540, courierCost: 1500, r, f }).net_kept);
    });
    const qtyInputs = page.locator("#pr-sample-fields input[type=number]");
    await qtyInputs.nth(0).fill("0"); await qtyInputs.nth(2).fill("2");
    check(`sample order: 2 x ₦780 + Lagos delivery leaves ${sampleKeep} (same maths as the server)`, (await text(page, "#pr-sample-result")).replace(/\s/g, "").includes("Youkeep" + sampleKeep), await text(page, "#pr-sample-result"));
    check("the sample shows the processor fee on the WHOLE amount and the commission on the products only", /Processor fee on the whole amount/.test(await text(page, "#pr-sample-result")) && /₦66\.65/.test(await text(page, "#pr-sample-result")) && /₦124\.80/.test(await text(page, "#pr-sample-result")), await text(page, "#pr-sample-result"));

    // layout
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bad: [...document.querySelectorAll("#pr-main input, #pr-main select, #pr-main button")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > document.documentElement.clientWidth + 0.5 || r.left < -0.5); }).length }));
    check(`${label}: no horizontal scroll (${overflow.sw}/${overflow.cw}) and every control fits the screen`, overflow.sw <= overflow.cw && overflow.bad === 0, JSON.stringify(overflow));
    if (shots) await page.screenshot({ path: `${shots}/admin-pricing-${w}.png`, fullPage: true });

    {
      // the sticky bar: always on screen, counts unsaved edits, and saving needs no scrolling
      const barBox = await page.locator("#pr-actionbar").boundingBox();
      const vh = await page.evaluate(() => window.innerHeight);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      const atTop = await page.locator("#pr-actionbar").boundingBox();
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      const atBottom = await page.locator("#pr-actionbar").boundingBox();
      check(`${label}: the save bar is stuck to the bottom of the screen at the top AND at the bottom of the page`, Math.abs(atTop.y + atTop.height - vh) < 2 && Math.abs(atBottom.y + atBottom.height - vh) < 2 && barBox.width <= w + 1, JSON.stringify({ atTop, atBottom, vh }));
      check(`${label}: it counts the edits made so far and offers Review & save`, /^\d+ unsaved changes?$/.test(await text(page, "#pr-changes-count")) && await page.locator("#pr-review").isEnabled(), await text(page, "#pr-changes-count"));
      await page.waitForTimeout(150);
      const jumpBox = await page.locator(".admin-jump__up").boundingBox();
      check(`${label}: the floating jump buttons sit above the save bar, not under it`, jumpBox && jumpBox.y + jumpBox.height <= atBottom.y + 1, JSON.stringify({ jumpBox, atBottom }));
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    }

    if (w === 1280) {
      // saving: review diff, confirm, version bumps
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight / 2, behavior: "instant" }));
      const yBefore = await page.evaluate(() => window.pageYOffset);
      await page.click("#pr-review");
      await page.waitForSelector("#pr-review-body:not([hidden])");
      check("Review & save opens IN PLACE, over the page: the page does not jump or scroll, and the dialog is on screen", Math.abs((await page.evaluate(() => window.pageYOffset)) - yBefore) < 2 && await page.locator("#pr-confirm").isVisible() && await page.locator("#pr-note").isVisible());
      await page.fill("#pr-note", "Palm oil to 780");
      const diff = await page.locator("#pr-diff-list li").allTextContents();
      check("'Review & save' lists exactly what will change (and the sample/other edits don't count)", diff.includes("Palm Oil 50cl price ₦700 → ₦780") && diff.some((l) => /target net/.test(l)) && diff.some((l) => /Lagos delivery charge ₦1,500 → ₦1,540/.test(l)), diff.join(" | "));
      await page.keyboard.press("Escape");
      check("Escape closes it and saves nothing", await page.locator("#pr-diff").isHidden() && (await adminApi({ action: "get" })).config.version === base0);
      check("the edits are still there after closing (the count is unchanged)", /unsaved change/.test(await text(page, "#pr-changes-count")) && await page.locator("#pr-review").isEnabled());
      await page.click("#pr-review"); await page.waitForSelector("#pr-review-body:not([hidden])");
      await page.click("#pr-cancel");
      check("'Keep editing' closes it too", await page.locator("#pr-diff").isHidden());
      await page.click("#pr-review"); await page.waitForSelector("#pr-review-body:not([hidden])");
      check("a price at the recommendation shows no warning and Save is ready at once", await page.locator("#pr-warn").isHidden() && await page.locator("#pr-confirm").isEnabled());
      await page.fill("#pr-note", "Palm oil to 780");
      dialogs.length = 0;
      await page.click("#pr-confirm");
      await page.waitForFunction((v) => new RegExp("Version " + (v + 1) + " is live").test(document.getElementById("pr-version-line").textContent), base0);
      check("saving needs no extra pop-up", dialogs.length === 0);
      check("saved: 'Saved as version N', the dialog is closed and the page now shows that version live", /Saved as version/.test(await text(page, "#pr-notice")) && await page.locator("#pr-diff").isHidden());
      check("after saving there is nothing unsaved: the bar says so and Review & save is disabled", (await text(page, "#pr-changes-count")) === "No unsaved changes" && await page.locator("#pr-review").isDisabled());
      check("the public API now serves the new price and charge", (await publicPrices()).products.find((p) => p.id === "palm-oil-50cl").price_ngn === 780 && (await publicPrices()).delivery.lagos === 1540);
      check("the change log lists the new version (with its note) as live, and older ones with Revert", /Palm oil to 780/.test(await text(page, "#pr-log")) && (await page.locator("#pr-log .badge--ok").count()) === 1 && (await page.locator('#pr-log button:has-text("Revert")').count()) >= 1);

      // below the recommendation: an in-dialog warning that must be ticked
      const palm2 = card(page, "Palm Oil — 50cl");
      await palm2.locator("input").nth(2).fill("750");
      check("one edit: the bar says '1 unsaved change'", (await text(page, "#pr-changes-count")) === "1 unsaved change");
      await page.click("#pr-review"); await page.waitForSelector("#pr-review-body:not([hidden])");
      check("a price BELOW the recommendation shows a warning naming the product and both prices", await page.locator("#pr-warn").isVisible() && /Palm Oil 50cl: ₦750 is below the recommended ₦780/.test(await text(page, "#pr-warn-list")), await text(page, "#pr-warn"));
      check("...and Save stays disabled until it is acknowledged", await page.locator("#pr-confirm").isDisabled());
      await page.fill("#pr-note", "Cheaper palm oil");
      await page.click("#pr-cancel");
      check("(declining saves nothing)", (await adminApi({ action: "get" })).config.version === base0 + 1);
      await page.click("#pr-review"); await page.waitForSelector("#pr-review-body:not([hidden])");
      check("reopening starts with the warning unticked", await page.locator("#pr-warn-ok").isChecked() === false && await page.locator("#pr-confirm").isDisabled());
      await page.check("#pr-warn-ok");
      check("ticking it enables Save", await page.locator("#pr-confirm").isEnabled());
      await page.fill("#pr-note", "Cheaper palm oil");
      await page.click("#pr-confirm");
      await page.waitForFunction((v) => new RegExp("Version " + (v + 2) + " is live").test(document.getElementById("pr-version-line").textContent), base0);
      check("accepting it saves", (await publicPrices()).products.find((p) => p.id === "palm-oil-50cl").price_ngn === 750);

      // discard
      await card(page, "Palm Oil — 50cl").locator("input").nth(2).fill("999");
      await page.click("#pr-discard");
      check("Discard puts the live values back and clears the count", (await card(page, "Palm Oil — 50cl").locator("input").nth(2).inputValue()) === "750" && (await text(page, "#pr-changes-count")) === "No unsaved changes");

      // next change
      await card(page, "ASHE Honey — 50cl").locator("input").nth(2).fill("7100");
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.click("#pr-next-change");
      await page.waitForTimeout(700);
      check("'Next change' scrolls to the edited card", await page.evaluate(() => { const c = document.querySelector("#pr-main .pr-card.is-changed"); const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }));

      // stale page protection
      await adminApi({ action: "save", commission_rate: 0.09, note: "changed elsewhere" });
      await page.click("#pr-review"); await page.waitForSelector("#pr-review-body:not([hidden])");
      if (await page.locator("#pr-warn").isVisible()) await page.check("#pr-warn-ok");
      await page.click("#pr-confirm");
      await page.waitForFunction(() => /was changed/.test(document.getElementById("pr-save-status").textContent));
      check("saving from a stale page is refused with a clear message in the dialog (and nothing is overwritten)", /Reload to see the latest/.test(await text(page, "#pr-save-status")) && (await publicPrices()).products.find((p) => p.id === "ashe-honey-50cl").price_ngn === 7000);
      await page.click("#pr-cancel");
      await page.click("#pr-reload");
      await page.waitForFunction(() => document.getElementById("pr-commission").value === "9");

      // revert
      const v1btn = page.locator('#pr-log li:has-text("Version 1") button:has-text("Revert")');
      const first = (await adminApi({ action: "history" })).versions.at(-1).version;
      await page.locator(`#pr-log li:has(strong:text-is("Version ${first}")) button:has-text("Revert")`).click();
      await page.waitForFunction(() => /Reverted: saved as version/.test(document.getElementById("pr-notice").textContent));
      const pj = await publicPrices();
      check("Revert saves a NEW version with the old values (prices, charge and rate back to the original)", pj.products.find((p) => p.id === "palm-oil-50cl").price_ngn === 700 && pj.delivery.lagos === 1500 && pj.commission_rate === 0.08 && pj.version > base0 + 3, JSON.stringify(pj).slice(0, 160));
      const hist = (await adminApi({ action: "history" })).versions;
      check("nothing was deleted: every earlier version is still listed", hist.length >= base0 + 4 && hist.some((v) => v.version === first) && /Reverted to version/.test(hist[0].note), hist.map((v) => v.version).join());
      void v1btn;
    }
    check("no script errors on the page", errors.length === 0, errors.join("|"));
    await ctx.close();
  }

  /* ================= the admin hub ================= */
  {
    const ctx = await newCtx(); const page = await ctx.newPage();
    await page.goto(base + "/admin.html");
    check("admin.html links to the pricing page", (await page.getAttribute('a[href="admin-pricing.html"]', "href")) === "admin-pricing.html" && /Pricing/.test(await page.textContent('a[href="admin-pricing.html"] h2')));
    await ctx.close();
  }

  /* ================= storefront ================= */
  const orig = await publicPrices();
  check("(state) the live prices are the original ones again", orig.products.find((p) => p.id === "ashe-honey-50cl").price_ngn === 7000);
  await adminApi({ action: "save", products: { "ashe-honey-50cl": { price_ngn: 7500 }, "palm-oil-50cl": { price_ngn: 800 } }, delivery: { lagos: { customer_charge_ngn: 1850 } }, commission_rate: 0.1, note: "storefront test" });

  console.log("-- storefront pages read the API");
  {
    const ctx = await newCtx(); const page = await ctx.newPage();
    await page.goto(base + "/products.html");
    await page.waitForFunction(() => document.querySelector('[data-product-id="ashe-honey-50cl"]').textContent.includes("7,500"));
    check("products.html: every price is marked data-product-id and shows the live price", (await page.locator("[data-product-id]").count()) === 4 && (await text(page, '[data-product-id="ashe-honey-50cl"]')) === "₦7,500" && (await text(page, '[data-product-id="palm-oil-50cl"]')) === "₦800" && (await text(page, '[data-product-id="ashe-honey-1l"]')) === "₦13,000");
    await page.goto(base + "/index.html");
    await page.waitForFunction(() => document.querySelector('[data-product-id="ashe-honey-50cl"]').textContent.includes("7,500"));
    check("index.html: its two prices follow the API too", (await text(page, '[data-product-id="palm-oil-50cl"]')) === "₦800");
    await page.goto(base + "/affiliate-signup.html");
    await page.waitForFunction(() => document.querySelector("[data-commission-rate]").textContent === "10%");
    check("the affiliate pages show the CURRENT commission rate (10%) everywhere it is mentioned", (await page.locator("[data-commission-rate]").allTextContents()).every((t) => t === "10%") && (await page.locator("[data-commission-rate]").count()) >= 3);
    await page.goto(base + "/my-stats.html?code=NOPE1"); await page.waitForTimeout(300);
    await ctx.close();
    const nojs = await newCtx(1280, 900, { javaScriptEnabled: false }); const pg = await nojs.newPage();
    await pg.goto(base + "/products.html");
    check("with JavaScript off the baked-in prices remain (no-JS fallback)", (await text(pg, '[data-product-id="ashe-honey-50cl"]')) === "₦7,000" && (await text(pg, '[data-product-id="palm-oil-50cl"]')) === "₦700");
    await nojs.close();
  }

  console.log("-- cart: stores ids only, reprices, tells the shopper");
  {
    const ctx = await newCtx(); const page = await ctx.newPage();
    await page.goto(base + "/products.html");
    await page.waitForFunction(() => document.querySelector('[data-product-id="ashe-honey-50cl"]').textContent.includes("7,500"));
    await page.click('[data-add-to-cart="ashe-honey-50cl"]'); await page.click('[data-add-to-cart="ashe-honey-50cl"]'); await page.click('[data-add-to-cart="palm-oil-50cl"]');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("xny_cart")));
    check("Add to Cart stores ONLY id and qty (no price, name or size)", stored.length === 2 && stored.every((i) => JSON.stringify(Object.keys(i).sort()) === JSON.stringify(["id", "qty"])) && stored[0].qty === 2, JSON.stringify(stored));
    await page.goto(base + "/cart.html");
    await page.waitForFunction(() => document.getElementById("cart-subtotal").textContent !== "₦0");
    check("the cart total uses today's prices: 2 x 7,500 + 800 = ₦15,800", (await text(page, "#cart-subtotal")) === "₦15,800", await text(page, "#cart-subtotal"));
    check("no 'prices were updated' notice when nothing changed since they added the items", await page.locator("#cart-price-notice").isHidden());
    check("delivery shows the live Lagos charge (₦1,850) and the other-states one", (await text(page, "[data-rate-lagos]")) === "₦1,850" && (await text(page, "[data-rate-other]")) === "₦3,500");
    await ctx.close();

    // a cart saved by the OLD site (carrying its own price) + a price change since
    const old = await newCtx(); const pg = await old.newPage();
    await pg.addInitScript(() => { if (!localStorage.getItem("xny_cart")) localStorage.setItem("xny_cart", JSON.stringify([{ id: "ashe-honey-50cl", name: "ASHE Honey", size: "50cl", price: 7000, qty: 2 }, { id: "palm-oil-1l", name: "Palm Oil", size: "1 Litre", price: 1300, qty: 1 }])); });
    await pg.goto(base + "/cart.html");
    await pg.waitForFunction(() => document.getElementById("cart-subtotal").textContent !== "₦0");
    check("an old cart (saved at 7,000) is repriced at 7,500: 2 x 7,500 + 1,300 = ₦16,300", (await text(pg, "#cart-subtotal")) === "₦16,300", await text(pg, "#cart-subtotal"));
    await pg.waitForSelector("#cart-price-notice:not([hidden])");
    check("a one-line notice says 'Prices were updated'", /^Prices were updated/.test(await text(pg, "#cart-price-notice")));
    const migrated = await pg.evaluate(() => JSON.parse(localStorage.getItem("xny_cart")));
    check("the old cart was migrated: only id and qty remain, the stale price is gone", migrated.every((i) => JSON.stringify(Object.keys(i).sort()) === JSON.stringify(["id", "qty"])) && !JSON.stringify(migrated).includes("7000"), JSON.stringify(migrated));
    await pg.reload();
    await pg.waitForFunction(() => document.getElementById("cart-subtotal").textContent !== "₦0");
    await pg.waitForTimeout(300);
    check("the notice is shown once: after the shopper has seen the new prices it does not repeat", await pg.locator("#cart-price-notice").isHidden());
    await old.close();
  }

  console.log("-- checkout: blocked when prices can't be loaded; charged amount = shown amount");
  {
    // an approved affiliate so the order logs a referral
    await harness.kv.put("affiliate:BRW01", JSON.stringify({ name: "Browser Test", email: "brw@example.com", approved_at: "x", status: "active" }), { metadata: { n: "Browser Test", e: "brw@example.com", at: "x", s: "active" } });
    const setup = (page) => page.addInitScript(() => {
      localStorage.setItem("xny_cart", JSON.stringify([{ id: "ashe-honey-50cl", qty: 2 }, { id: "palm-oil-50cl", qty: 1 }]));
      localStorage.setItem("xny_ref_code", "BRW01");
      window.__fw = [];
      window.FlutterwaveCheckout = function (o) { window.__fw.push(o); };
    });
    const fillCheckout = async (page) => {
      await page.check('[data-delivery-radio][value="lagos"]');
      await page.click("#proceed-checkout-btn");
      await page.fill("#co-name", "Test Buyer"); await page.fill("#co-email", "buyer@example.com"); await page.fill("#co-phone", "08031234567"); await page.fill("#co-address", "1 Test Street");
    };

    // 1. pricing unavailable from the start
    await fetchFlag(base, true);
    const c1 = await newCtx(); const p1 = await c1.newPage(); await setup(p1);
    await p1.goto(base + "/cart.html");
    await p1.waitForSelector("#pricing-error:not([hidden])");
    check("pricing fetch fails: a retry message is shown", /couldn.t load today.s prices/.test(await text(p1, "#pricing-error")) && await p1.locator("#pricing-retry").isVisible());
    check("...and 'Proceed to checkout' is disabled, so nothing can be paid on a stale default", await p1.locator("#proceed-checkout-btn").isDisabled() && await p1.locator("#pay-now-btn").isDisabled());
    await p1.evaluate(() => document.getElementById("pay-now-btn").click());
    check("(even a forced click opens no payment window)", (await p1.evaluate(() => window.__fw.length)) === 0);
    await fetchFlag(base, false);
    await p1.click("#pricing-retry");
    await p1.waitForSelector("#pricing-error", { state: "hidden" });
    check("'Try again' loads the prices, clears the message and unblocks checkout", await p1.locator("#proceed-checkout-btn").isEnabled() && (await text(p1, "#cart-subtotal")) === "₦15,800");
    await c1.close();

    // 2. pricing fails at the moment of paying
    const c2 = await newCtx(); const p2 = await c2.newPage(); await setup(p2);
    await p2.goto(base + "/cart.html");
    await p2.waitForFunction(() => document.getElementById("cart-subtotal").textContent === "₦15,800");
    await fillCheckout(p2);
    await fetchFlag(base, true);
    await p2.click("#pay-now-btn");
    await p2.waitForFunction(() => /couldn.t load today.s prices/.test(document.getElementById("checkout-status").textContent));
    check("the prices are re-fetched when Pay is pressed; if that fails, payment is paused and the window never opens", (await p2.evaluate(() => window.__fw.length)) === 0 && await p2.locator("#pricing-error").isVisible());
    await fetchFlag(base, false);
    await p2.click("#pricing-retry");
    await p2.waitForSelector("#pricing-error", { state: "hidden" });

    // 3. prices change between display and pay
    await adminApi({ action: "save", products: { "ashe-honey-50cl": { price_ngn: 7600 } }, note: "price moved while checking out" });
    await p2.click("#pay-now-btn");
    await p2.waitForFunction(() => /Prices were updated/.test(document.getElementById("checkout-status").textContent));
    check("prices changed while the shopper was checking out: payment does NOT start; they are told and shown the new total (2 x 7,600 + 800 + 1,850)", (await p2.evaluate(() => window.__fw.length)) === 0 && (await text(p2, "#cart-total")) === "₦17,850" && await p2.locator("#cart-price-notice").isVisible(), await text(p2, "#cart-total"));

    // 4. the server prices the order; a short payment is NOT accepted, a full one is
    const ver = (await publicPrices()).version;
    const orderReqs = [];
    p2.on("request", (r) => { if (r.url().includes("/api/create-order")) orderReqs.push(r.postData()); });
    await p2.click("#pay-now-btn");
    await p2.waitForFunction(() => window.__fw.length === 1);
    let opts = await p2.evaluate(() => window.__fw[0]);
    check("Flutterwave is opened with the SERVER's reference and exactly the displayed total (₦17,850)", /^xny-\d{13}-[a-f0-9]{8}$/.test(opts.tx_ref) && opts.amount === 17850 && opts.currency === "NGN", JSON.stringify(opts).slice(0, 160));
    check("the order request carries ids + quantities, the delivery choice and the customer, and NO price or total", orderReqs.length === 1 && (b => JSON.stringify(b.items) === JSON.stringify([{ id: "ashe-honey-50cl", qty: 2 }, { id: "palm-oil-50cl", qty: 1 }]) && b.fulfilment === "lagos" && b.ref_code === "BRW01" && !/price|amount|total|commission/i.test(JSON.stringify(b)))(JSON.parse(orderReqs[0] || "{}")), orderReqs[0]);
    const srvOrder = JSON.parse(await harness.kv.get("order:" + opts.tx_ref));
    check("the order was stored on the server as pending at the server's price (subtotal 16,000, delivery 1,850)", srvOrder.status === "pending" && srvOrder.total_ngn === 17850 && srvOrder.subtotal_ngn === 16000 && srvOrder.pricing_version === ver);
    // the shopper tampers: the window charges ₦1 and the page is told "successful"
    await A.get(`${base}/__flw?mode=short`);
    await p2.evaluate(() => window.__fw[0].callback({ status: "successful", amount: 17850, transaction_id: 1 }));
    await p2.waitForFunction(() => /couldn.t match your payment/.test(document.getElementById("checkout-status").textContent));
    const afterShort = JSON.parse(await harness.kv.get("order:" + opts.tx_ref));
    check("a short payment is NOT accepted: the order is flagged underpaid, no commission, the cart is kept, the shopper is told the reference", afterShort.status === "underpaid" && (await harness.kv.list({ prefix: "referral:BRW01:" })).keys.length === 0 && (await p2.evaluate(() => localStorage.getItem("xny_cart"))) !== "[]" && (await text(p2, "#checkout-status")).includes(opts.tx_ref));
    check("...and the business was sent an ALERT, not an order notification", harness.mails.some((m) => /ALERT/.test(m.subject) && m.subject.includes(opts.tx_ref)) && !harness.mails.some((m) => /^New Order/.test(m.subject)));
    // an honest payment
    await A.get(`${base}/__flw?mode=pay`);
    await p2.click("#pay-now-btn");
    await p2.waitForFunction(() => window.__fw.length === 2);
    opts = await p2.evaluate(() => window.__fw[1]);
    await p2.evaluate(() => window.__fw[1].callback({ status: "successful" }));
    await p2.waitForSelector("#order-confirmation:not([hidden])", { state: "visible" });
    const keys = (await harness.kv.list({ prefix: "referral:BRW01:" })).keys;
    const stored = JSON.parse(await harness.kv.get(keys[0].name));
    check("a full, Flutterwave-confirmed payment shows the confirmation and the server credits the commission: 16,000 x 10% = 1,600", keys.length === 1 && keys[0].name === "referral:BRW01:" + opts.tx_ref && stored.pricing_version === ver && stored.order_total_ngn === 16000 && stored.verified === true && stored.commission_rate === 0.1 && stored.commission_ngn === 1600, JSON.stringify(stored));
    check("exactly one 'New Order' email went to the business, naming the reference", harness.mails.filter((m) => /^New Order/.test(m.subject) && m.subject.includes(opts.tx_ref)).length === 1);
    const cartAfter = await p2.evaluate(() => localStorage.getItem("xny_cart"));
    check("the cart is cleared after a confirmed payment", cartAfter === "[]");
    check("the confirmation page names the server's reference, and there is no 'resend order email' step any more", (await text(p2, "#order-confirmation")).includes(opts.tx_ref) && (await p2.locator("#resend-email-btn").count()) === 0);
    await c2.close();
  }
  await api.close();

  async function fetchFlag(b, on) { await A.get(`${b}/__pricing-fail?on=${on ? 1 : 0}`); }
}
