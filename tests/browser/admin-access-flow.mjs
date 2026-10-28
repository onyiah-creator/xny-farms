import { makeKey, jwksDoc, claims, sign, TEAM, AUD } from "../helpers/access-jwt.mjs";

export default async function ({ browser, harness, base, check }) {
  const PW = "admin-pw";
  const EXPIRED = "Your session expired. Reload this page to sign in again.";
  const newCtx = (w = 1280, h = 900, extra = {}) => browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700, ...extra });
  const api = await browser.newContext(); const A = api.request;
  const adminApi = async (path, body) => (await A.post(`${base}/api/${path}`, { data: { password: PW, ...body } })).json();
  const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // sign in on each of the four pages; returns the element that carries the result text
  const PAGES = {
    "admin.html": async (p) => { await p.fill("#hub-password", PW); await p.click("#hub-signin"); },
    "admin-referrals.html": async (p) => { await p.fill("#admin-password", PW); await p.click("#admin-submit"); },
    "admin-pricing.html": async (p) => { await p.fill("#pr-password", PW); await p.click("#pr-signin"); },
    "admin-approve-affiliate.html": async (p) => { await p.fill("#ap-password", PW); await p.click("#ap-signin"); }
  };
  const STATUS = { "admin.html": "#hub-status", "admin-referrals.html": "#admin-status", "admin-pricing.html": "#pr-gate-status", "admin-approve-affiliate.html": "#ap-gate-status" };
  const SIGNED_IN = { "admin.html": "#hub-activity", "admin-referrals.html": "#admin-report", "admin-pricing.html": "#pr-main", "admin-approve-affiliate.html": "#approve-main" };

  /* ---------- the banner ---------- */
  console.log("-- banner: Cloudflare Access not enforced");
  for (const page of Object.keys(PAGES)) {
    const ctx = await newCtx(); const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${base}/${page}`);
    check(`${page}: no banner before sign-in (it needs the password)`, await p.locator("#access-banner").isHidden());
    await PAGES[page](p);
    await p.waitForSelector(`${SIGNED_IN[page]}:not([hidden])`);
    await p.waitForSelector("#access-banner:not([hidden])");
    const cls = await p.getAttribute("#access-banner", "class");
    check(`${page}: amber warning "Cloudflare Access is not enforced"`, /access-banner--warn/.test(cls) && /^Cloudflare Access is not enforced/.test(await text(p, "#access-banner")) && /only thing protecting/.test(await text(p, "#access-banner")), await text(p, "#access-banner"));
    check(`${page}: no script errors`, errors.length === 0, errors.join("|"));
    await ctx.close();
  }

  console.log("-- banner: Cloudflare Access enforced, valid JWT");
  const key = await makeKey("kid-browser");
  harness.setJwks(jwksDoc(key));
  const now = Date.now();
  const token = await sign(key, claims(now, { email: "owner@xnyfarms.com" }));
  Object.assign(harness.env, { ACCESS_ENFORCE: "true", CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD });
  try {
    for (const page of Object.keys(PAGES)) {
      const ctx = await newCtx(1280, 900, { extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": token } }); const p = await ctx.newPage();
      await p.goto(`${base}/${page}`);
      await PAGES[page](p);
      await p.waitForSelector(`${SIGNED_IN[page]}:not([hidden])`);
      await p.waitForSelector("#access-banner:not([hidden])");
      check(`${page}: green "Protected by Cloudflare Access as owner@xnyfarms.com"`, /access-banner--ok/.test(await p.getAttribute("#access-banner", "class")) && (await text(p, "#access-banner")) === "Protected by Cloudflare Access as owner@xnyfarms.com", await text(p, "#access-banner"));
      await ctx.close();
    }
    // 375px: the banner and the page still fit
    const mctx = await newCtx(375, 800, { extraHTTPHeaders: { "Cf-Access-Jwt-Assertion": token } }); const mp = await mctx.newPage();
    await mp.goto(`${base}/admin-pricing.html`); await PAGES["admin-pricing.html"](mp);
    await mp.waitForSelector("#access-banner:not([hidden])");
    check("375px: the banner fits the screen (no horizontal scroll)", await mp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await mctx.close();

    console.log("-- enforced, but the browser has no Access session");
    for (const page of Object.keys(PAGES)) {
      const ctx = await newCtx(); const p = await ctx.newPage();
      await p.goto(`${base}/${page}`);
      await PAGES[page](p);
      await p.waitForFunction(([sel, msg]) => document.querySelector(sel).textContent === msg, [STATUS[page], EXPIRED]);
      check(`${page}: the server's "Access required" answer is shown as the plain session-expired message, not JSON or an error code`, (await text(p, STATUS[page])) === EXPIRED && await p.locator(SIGNED_IN[page]).isHidden());
      await ctx.close();
    }
  } finally {
    delete harness.env.ACCESS_ENFORCE; delete harness.env.CF_ACCESS_TEAM_DOMAIN; delete harness.env.CF_ACCESS_AUD;
  }

  /* ---------- an expired Access session: redirect to the login page, or an HTML page ---------- */
  console.log("-- expired Access session (redirect to the login page / HTML / not JSON)");
  const variants = {
    "a redirect to the Access login page": (route) => route.fulfill({ status: 302, headers: { Location: `https://${TEAM}/cdn-cgi/access/login/xnyfarms.com?kid=1` }, body: "" }),
    "an HTML login page with status 200": (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Sign in</title><h1>Sign in to continue</h1>" }),
    "plain text": (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "Forbidden" }),
    "an HTML 403 from Access": (route) => route.fulfill({ status: 403, contentType: "text/html", body: "<html>Access denied</html>" })
  };
  for (const [label, handler] of Object.entries(variants)) {
    for (const page of Object.keys(PAGES)) {
      const ctx = await newCtx(); const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
      await p.route("**/api/**", handler);
      await p.goto(`${base}/${page}`);
      await PAGES[page](p);
      await p.waitForFunction(([sel, msg]) => document.querySelector(sel).textContent === msg, [STATUS[page], EXPIRED], { timeout: 5000 }).catch(() => {});
      check(`${page} / ${label}: "${EXPIRED}"`, (await text(p, STATUS[page])) === EXPIRED && errors.length === 0, `${await text(p, STATUS[page])} ${errors.join("|")}`);
      await ctx.close();
    }
  }
  {
    // mid-session, on the pricing page: the session lapses after sign-in
    const ctx = await newCtx(); const p = await ctx.newPage();
    await p.goto(`${base}/admin-pricing.html`); await PAGES["admin-pricing.html"](p);
    await p.waitForSelector("#pr-main:not([hidden])");
    await p.route("**/api/**", variants["a redirect to the Access login page"]);
    await p.click("#pr-reload");
    await p.waitForFunction((m) => document.getElementById("pr-notice").textContent === m, EXPIRED);
    check("pricing, mid-session: Reload says the session expired, and the editor stays on screen (nothing is lost)", await p.locator("#pr-main").isVisible());
    await p.locator("#pr-products .pr-card").first().locator("input").nth(2).fill("7777");
    await p.click("#pr-review");
    await p.waitForFunction((m) => document.getElementById("pr-save-status").textContent === m, EXPIRED);
    check("pricing, mid-session: Review & save shows the same message inside the dialog, and the save button stays off", await p.locator("#pr-confirm").isDisabled());
    await ctx.close();
    const ctx2 = await newCtx(); const p2 = await ctx2.newPage();
    await p2.goto(`${base}/admin-referrals.html`); await PAGES["admin-referrals.html"](p2);
    await p2.waitForSelector("#admin-report:not([hidden])");
    check("(sanity) with the route removed the referral report loads normally", await p2.locator("#admin-report").isVisible());
    await ctx2.close();
  }

  /* ---------- the activity log on the hub ---------- */
  console.log("-- activity log (admin.html)");
  {
    await adminApi("admin-pricing", { action: "save", products: { "palm-oil-50cl": { price_ngn: 771 } }, note: "audit test" });
    await adminApi("register-affiliate", { code: "XSSCODE1", name: "<img src=x onerror=window.__pwned=1>", email: "xss@example.com" });
    for (const [w, h] of [[1280, 900], [375, 800]]) {
      const ctx = await newCtx(w, h); const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
      await p.goto(`${base}/admin.html`);
      check(`${w}px: the activity log is hidden until sign-in`, await p.locator("#hub-activity").isHidden());
      await p.fill("#hub-password", "wrong"); await p.click("#hub-signin");
      await p.waitForFunction(() => /Incorrect/.test(document.getElementById("hub-status").textContent));
      check(`${w}px: a wrong password shows an error and nothing else`, await p.locator("#hub-activity").isHidden());
      await p.fill("#hub-password", PW); await p.click("#hub-signin");
      await p.waitForSelector("#hub-activity:not([hidden])");
      const items = await p.locator("#audit-list .audit-item").allTextContents();
      const iReg = items.findIndex((t) => /affiliate registered/.test(t) && /XSSCODE1/.test(t)), iPrice = items.findIndex((t) => /pricing save/.test(t));
      check(`${w}px: shows time, who, action and summary for recent actions, newest first`, iReg >= 0 && iPrice > iReg && /Palm Oil 50cl price/.test(items[iPrice]) && /password-only/.test(items[iPrice]) && /\d{4}/.test(items[iPrice]), items.slice(0, 3).join(" | "));
      check(`${w}px: a hostile affiliate name is shown as text, never run as HTML`, (await p.locator("#audit-list img").count()) === 0 && /<img src=x/.test(items[iReg]) && (await p.evaluate(() => window.__pwned)) === undefined);
      check(`${w}px: no horizontal scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
      check(`${w}px: the count line is shown`, /\d+ entr(y|ies)\./.test(await text(p, "#hub-count")));
      const before = await p.locator("#audit-list .audit-item").count();
      await adminApi("set-affiliate-status", { code: "XSSCODE1", status: "suspended" });
      await p.click("#hub-refresh");
      await p.waitForFunction((n) => document.querySelectorAll("#audit-list .audit-item").length > n, before);
      check(`${w}px: Refresh picks up new activity at the top`, /affiliate suspended/.test((await p.locator("#audit-list .audit-item").first().textContent())));
      check(`${w}px: no script errors`, errors.length === 0, errors.join("|"));
      await ctx.close();
      await adminApi("set-affiliate-status", { code: "XSSCODE1", status: "active" });
    }
  }
  await api.close();
  void sleep;
}
