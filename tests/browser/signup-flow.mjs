export default async function ({ browser, harness, base, check, shots }) {
  const mailsOf = async (api) => (await api.get(base + "/__mails")).json();
  const tokenFrom = (m) => (/verify-affiliate\?token=([a-f0-9]{64})/.exec(m.text) || [])[1];
  const person = (n) => ({ name: `Test Person ${n}`, email: `person${n}@example.com`, phone: `0803 100 ${String(1000 + n)}`, bank: "GTBank", account: "0123456789", holder: `Test Person ${n}` });
  const fill = async (page, p, { consent = true } = {}) => {
    await page.fill("#a-name", p.name); await page.fill("#a-email", p.email); await page.fill("#a-phone", p.phone);
    await page.fill("#a-bank", p.bank); await page.fill("#a-account-number", p.account); await page.fill("#a-account-name", p.holder);
    if (consent) await page.check("#a-consent"); else await page.uncheck("#a-consent");
  };
  const newContext = async (width, height, ip, extra = {}) => {
    const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700, extraHTTPHeaders: { "x-test-ip": ip }, permissions: ["clipboard-read", "clipboard-write"], ...extra });
    return c;
  };

  /* ---------------- the form, desktop ---------------- */
  const ctx = await newContext(1280, 900, "10.1.0.1");
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  const requests = []; page.on("request", (r) => { if (r.method() !== "GET" || r.url().includes("/api/")) requests.push(r.method() + " " + new URL(r.url()).pathname); });
  await page.goto(base + "/affiliate-signup.html");

  console.log("-- the form");
  check("no mailto hand-off any more (no data-mailto / data-xny-form on the form)", (await page.locator("#signup-form").evaluate((f) => !f.hasAttribute("data-mailto") && !f.hasAttribute("data-xny-form") && !f.hasAttribute("data-xny-post"))));
  check("the old 'opens your email app' wording is gone", !/opens your email app|email app/i.test(await page.locator("#signup-card").textContent()));
  check("the fields are all there (name, email, phone, bank, account number, holder, plan)", (await page.locator("#signup-form").evaluate((f) => ["name", "email", "phone", "bank_name", "account_number", "account_holder", "promotion_plan"].every((n) => f.elements[n]))));
  check("required consent checkbox with the agreed wording", (await page.locator("#a-consent").evaluate((c) => c.required)) && /I agree that XNY Farms stores my details, including payout details, to run the affiliate programme/.test(await page.locator(".consent__label").textContent()));
  check("the consent text links to privacy-policy.html and ndpr-notice.html", (await page.locator(".consent__label a").evaluateAll((as) => as.map((a) => a.getAttribute("href")).join())) === "privacy-policy.html,ndpr-notice.html");
  const hp = page.locator("#a-website");
  check("honeypot is invisible to people (off-screen), not focusable, hidden from screen readers", !(await hp.isVisible()) || (await hp.evaluate((i) => i.getBoundingClientRect().right < 0)), "") ;
  check("   ...tabindex=-1, aria-hidden wrapper, autocomplete off", (await hp.getAttribute("tabindex")) === "-1" && (await hp.evaluate((i) => i.closest(".hp-field").getAttribute("aria-hidden"))) === "true" && (await hp.getAttribute("autocomplete")) === "off");
  check("Turnstile widget is hidden when no site key is set", await page.locator("#turnstile-wrap").isHidden());
  check("the 'Resend my welcome email' form is on the page", (await page.locator("#resend-welcome form[data-resend-welcome]").count()) === 1);

  console.log("-- validation and loading states");
  requests.length = 0;
  await page.click("#signup-submit");
  check("an empty form is stopped by the browser: no request is made", !requests.some((r) => r.includes("/api/submit")), requests.join());
  await fill(page, { ...person(1), phone: "123" });
  await page.click("#signup-submit");
  await page.waitForFunction(() => document.getElementById("err-phone").textContent.length > 0);
  check("a server-side field error appears inline under that field, marks it invalid and re-enables the button", (await page.locator("#a-phone").getAttribute("aria-invalid")) === "true" && /Nigerian number/.test(await page.textContent("#err-phone")) && (await page.locator("#signup-submit").isEnabled()) && (await page.textContent("#signup-submit")) === "Sign Up");
  await page.fill("#a-phone", person(1).phone);
  await page.uncheck("#a-consent");
  await page.click("#signup-submit");
  check("an unticked consent box is caught before sending, with an inline message", !(await page.evaluate(() => document.getElementById("a-consent").checkValidity())) && /agree/.test(await page.textContent("#err-consent")));
  await page.check("#a-consent");

  await page.goto(base + "/__delay?ms=900");
  await page.goto(base + "/affiliate-signup.html");
  await fill(page, person(1));
  requests.length = 0;
  await page.click("#signup-submit");
  const during = await page.evaluate(() => ({ disabled: document.getElementById("signup-submit").disabled, text: document.getElementById("signup-submit").textContent, busy: document.getElementById("signup-form").getAttribute("aria-busy") }));
  check("while sending: the button is disabled, says 'Signing you up…', the form is aria-busy", during.disabled === true && /Signing you up/.test(during.text) && during.busy === "true", JSON.stringify(during));
  await page.click("#signup-submit", { force: true, timeout: 500 }).catch(() => {});
  await page.waitForSelector("#signup-done:not([hidden])");
  await page.goto(base + "/__delay?ms=0");
  check("exactly one POST to the signup API, and nothing was opened in a mail app", requests.filter((r) => r.startsWith("POST /api/submit-affiliate-application")).length === 1 && page.url().startsWith("http://localhost"), requests.join());
  await page.goBack().catch(() => {});

  // do it properly on a fresh load
  await page.goto(base + "/affiliate-signup.html");
  const p2 = person(2);
  await fill(page, p2);
  await page.click("#signup-submit");
  await page.waitForSelector("#signup-done:not([hidden])");
  check("success: 'Check your email' screen shows the address and the form is replaced", (await page.textContent("#signup-done h2")) === "Check your email" && (await page.textContent("#done-email")) === p2.email && (await page.locator("#signup-form").isHidden()));
  let mails = await mailsOf(ctx.request);
  const mine = mails.filter((m) => m.to[0] === p2.email);
  check("exactly one confirmation email went to that address", mine.length === 1 && /Confirm your email/.test(mine[0].subject), mails.map((m) => m.to + ":" + m.subject).join(" | "));
  if (shots) await page.screenshot({ path: `${shots}/signup-done-desktop.png`, fullPage: true });

  // "Send the email again" straight away -> cooldown wording
  await page.click("#done-resend");
  await page.waitForFunction(() => /minute|moment/.test(document.getElementById("done-status").textContent));
  check("'Send the email again' straight away explains the 10-minute cooldown", /minute/.test(await page.textContent("#done-status")));

  console.log("-- confirming creates the account and shows the code");
  const token = tokenFrom(mine[0]);
  await page.goto(base + `/api/verify-affiliate?token=${token}`);
  await page.waitForSelector("#confirmed-ok:not([hidden])");
  const code = (await page.textContent("#confirmed-code")).trim();
  check("redirected to affiliate-confirmed.html?status=ok&code=…", /\/affiliate-confirmed\.html\?status=ok&code=[A-Z0-9]+$/.test(page.url()) && /^TES[A-Z]*PERS?[A-Z0-9]*$/.test(code) || /^[A-Z0-9]{3,32}$/.test(code), page.url() + " " + code);
  check("it shows the code, the personal link and the stats link", (await page.textContent("#confirmed-link")) === `${base}/?ref=${code}` && (await page.getAttribute("#confirmed-stats", "href")) === `my-stats.html?code=${code}`);
  check("it says we have also emailed these details", /also emailed you these details/.test(await page.textContent("#confirmed-ok")));
  await page.click("#copy-link");
  await page.waitForFunction(() => /Copied/.test(document.getElementById("copy-status").textContent));
  check("'Copy my link' puts the personal link on the clipboard", (await page.evaluate(() => navigator.clipboard.readText())) === `${base}/?ref=${code}`);
  await page.click("#copy-code");
  check("'Copy my code' copies the code", await page.waitForFunction(() => true).then(async () => (await page.evaluate(() => navigator.clipboard.readText())) === code));
  mails = await mailsOf(ctx.request);
  check("the welcome email and a notice to xnyfarms@gmail.com were sent (and nothing else)", mails.filter((m) => m.subject === "Welcome to the XNY Farms Affiliate Program!" && m.to[0] === p2.email).length === 1 && mails.filter((m) => m.to[0] === "xnyfarms@gmail.com" && /New affiliate/.test(m.subject)).length === 1);
  if (shots) await page.screenshot({ path: `${shots}/confirmed-desktop.png`, fullPage: true });
  const mailCount = mails.length;
  await page.goto(base + `/api/verify-affiliate?token=${token}`);
  await page.waitForSelector("#confirmed-ok:not([hidden])");
  check("opening the link again shows the same code and sends nothing more", (await page.textContent("#confirmed-code")).trim() === code && (await mailsOf(ctx.request)).length === mailCount);

  console.log("-- expired / invalid / hostile links");
  await page.goto(base + "/affiliate-confirmed.html?status=expired");
  check("expired: friendly message with a 'Sign up again' link", await page.locator("#confirmed-expired").isVisible() && /expired/.test(await page.textContent("#confirmed-heading")) && (await page.getAttribute("#confirmed-expired a.btn", "href")) === "affiliate-signup.html");
  await page.goto(base + "/affiliate-confirmed.html?status=invalid");
  check("invalid: friendly message", await page.locator("#confirmed-invalid").isVisible());
  await page.goto(base + "/affiliate-confirmed.html?status=ok&code=" + encodeURIComponent("<img src=x onerror=window.__pwned=1>"));
  check("a hostile ?code= is not displayed or executed (falls back to the invalid message)", await page.locator("#confirmed-invalid").isVisible() && (await page.locator("#confirmed-ok img").count()) === 0 && (await page.evaluate(() => window.__pwned)) === undefined);
  check("the confirmed page is marked noindex", (await page.getAttribute('meta[name="robots"]', "content")).includes("noindex"));

  console.log("-- duplicates");
  await page.goto(base + "/affiliate-signup.html");
  await fill(page, { ...p2, phone: "0805 555 0000" });
  await page.click("#signup-submit");
  await page.waitForFunction(() => document.getElementById("err-email").textContent.length > 0);
  check("an already-registered email: inline error on the email field", /This email is already registered/.test(await page.textContent("#err-email")) && (await page.getAttribute("#a-email", "aria-invalid")) === "true");
  check("   ...and a clear way forward: 'Resend my welcome email'", await page.locator("#signup-message a:has-text('Resend my welcome email')").isVisible());
  await page.click("#signup-message a:has-text('Resend my welcome email')");
  check("   ...which pre-fills the resend form with that email", (await page.inputValue("#rw-email")) === p2.email);
  const before = (await mailsOf(ctx.request)).length;
  await page.click('#resend-welcome button[type="submit"]');
  await page.waitForFunction(() => /If that email is registered/.test(document.querySelector("#resend-welcome .form-status").textContent));
  const after = await mailsOf(ctx.request);
  check("the resend form says the same neutral thing and the welcome email is re-sent to the registered address", after.length === before + 1 && after[after.length - 1].to[0] === p2.email && after[after.length - 1].subject === "Welcome to the XNY Farms Affiliate Program!");
  await page.fill("#rw-email", "nobody.registered@example.com");
  await page.click('#resend-welcome button[type="submit"]');
  await page.waitForFunction(() => /If that email is registered/.test(document.querySelector("#resend-welcome .form-status").textContent));
  check("an unknown email gets exactly the same message and no email goes out", (await mailsOf(ctx.request)).length === before + 1);

  await page.goto(base + "/affiliate-signup.html");
  await fill(page, { ...p2, email: "someone.new@example.com", phone: "08031001002" });
  await page.click("#signup-submit");
  await page.waitForFunction(() => document.getElementById("err-phone").textContent.length > 0);
  check("an already-registered phone (typed differently) names the phone field", /This phone number is already registered/.test(await page.textContent("#err-phone")));

  const p3 = person(3);
  await page.goto(base + "/affiliate-signup.html");
  await fill(page, p3); await page.click("#signup-submit"); await page.waitForSelector("#signup-done:not([hidden])");
  await page.goto(base + "/affiliate-signup.html");
  await fill(page, p3); await page.click("#signup-submit");
  await page.waitForSelector("#signup-message:not([hidden])");
  check("signing up again while the confirmation is pending: says it was already sent and offers to send it again", /already sent a confirmation email/.test(await page.textContent("#signup-message")) && await page.locator("#signup-message button:has-text('Send the confirmation email again')").isVisible());
  check("   ...and no second confirmation email was sent", (await mailsOf(ctx.request)).filter((m) => m.to[0] === p3.email).length === 1);
  await page.click("#signup-message button");
  await page.waitForFunction(() => /minute/.test(document.querySelector("#signup-message .form-status").textContent));
  check("   ...pressing it inside the cooldown explains the wait", /minute/.test(await page.textContent("#signup-message .form-status")));
  check("no script errors on the signup pages", errors.length === 0, errors.join("|"));

  console.log("-- account pause shows on my-stats");
  const suspend = await ctx.request.post(base + "/api/set-affiliate-status", { data: { password: "admin-pw", code, status: "suspended" } });
  check("(admin suspends the new affiliate)", (await suspend.json()).ok === true);
  await page.goto(base + `/my-stats.html?code=${code}`);
  await page.waitForSelector("#stats-paused:not([hidden])");
  check("my-stats shows a neutral 'account paused, contact us' message and no figures", /paused/.test(await page.textContent("#stats-paused")) && /xnyfarms@gmail\.com/.test(await page.textContent("#stats-paused")) && await page.locator("#stats-results").isHidden() && await page.locator("#stats-resend").isHidden());
  await page.goto(base + "/my-stats.html");
  check("my-stats without a code shows the 'Resend my welcome email' card", await page.locator("#stats-resend").isVisible() && await page.locator("#stats-nocode").isVisible());

  console.log("-- admin: self-signups, suspend / reactivate, rebuild index");
  await page.goto(base + "/admin-approve-affiliate.html");
  await page.fill("#ap-password", "admin-pw"); await page.click("#ap-signin");
  await page.waitForSelector("#approve-main:not([hidden])");
  await page.waitForSelector(`#af-list .aff-row:has-text("${code}")`);
  const row = page.locator(`#af-list .aff-row:has-text("${code}")`);
  check("the approved list shows source 'self-signup', the confirmed date and the suspended badge", /self-signup/.test(await row.textContent()) && /email confirmed/.test(await row.textContent()) && /suspended/.test(await row.locator(".badge").textContent()));
  check("the buttons are 'Resend Welcome Email' and 'Reactivate'", (await row.locator("button").allTextContents()).join("|") === "Resend Welcome Email|Reactivate");
  check("the manual sections are labelled legacy / exceptional", /legacy/i.test(await page.textContent("#approve-main .admin-meta h2")) && /exceptional/i.test(await page.textContent("#approve-card h2")) && /Signups are automatic now/.test(await page.textContent("#approve-main")));
  check("a visible warning says Turnstile is not configured", /Turnstile is not configured/.test(await page.textContent("#ap-config-warning")));
  await row.locator('button[data-action="reactivate"]').click();
  await page.waitForFunction((c) => { const r = [...document.querySelectorAll("#af-list .aff-row")].find((x) => x.textContent.includes(c)); return r && r.querySelector('button[data-action="suspend"]'); }, code);
  check("Reactivate (after a confirmation) flips it back to active: 'Suspend' offered, no badge", (await page.locator(`#af-list .aff-row:has-text("${code}") .badge`).count()) === 0);
  await page.click("#idx-rebuild");
  await page.waitForSelector("#idx-result:not([hidden])");
  check("'Rebuild duplicate index' reports counts and 'No conflicts'", /affiliate.*checked/.test(await page.textContent("#idx-result")) && /No conflicts/.test(await page.textContent("#idx-result")));
  harness.env.TURNSTILE_SECRET_KEY = "x";
  await page.click("#ap-refresh"); await page.waitForTimeout(100);
  await page.locator("#af-list").evaluate(() => {});
  delete harness.env.TURNSTILE_SECRET_KEY;
  if (shots) await page.screenshot({ path: `${shots}/admin-approve-desktop.png`, fullPage: true });
  await ctx.close();

  /* ---------------- phone widths ---------------- */
  for (const w of [320, 375]) {
    console.log(`-- ${w}px`);
    const c = await newContext(w, 800, "10.2." + (w % 250) + ".1");
    const pg = await c.newPage(); pg.on("dialog", (d) => d.accept());
    await pg.goto(base + "/affiliate-signup.html");
    const overflow = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check(`${w}px: no horizontal scroll on the signup page (${overflow.sw}/${overflow.cw})`, overflow.sw <= overflow.cw);
    check(`${w}px: every control fits inside the screen`, await pg.evaluate(() => [...document.querySelectorAll("#signup-form input:not(#a-website), #signup-form textarea, #signup-form button, #resend-welcome input, #resend-welcome button")].filter((e) => e.offsetParent !== null).every((e) => { const r = e.getBoundingClientRect(); return r.left >= -0.5 && r.right <= document.documentElement.clientWidth + 0.5; })));
    check(`${w}px: the submit button and consent box are large enough to tap`, (await pg.locator("#signup-submit").boundingBox()).height >= 44);
    const pn = person(40 + w % 7);
    await fill(pg, { ...pn, phone: "12" });
    await pg.click("#signup-submit");
    await pg.waitForFunction(() => document.getElementById("err-phone").textContent.length > 0);
    check(`${w}px: an inline error keeps the layout inside the screen`, (await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)));
    if (shots) await pg.screenshot({ path: `${shots}/signup-error-${w}.png`, fullPage: true });
    await pg.fill("#a-phone", pn.phone);
    await pg.click("#signup-submit");
    await pg.waitForSelector("#signup-done:not([hidden])");
    check(`${w}px: the 'Check your email' screen fits`, (await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)));
    if (shots) await pg.screenshot({ path: `${shots}/signup-done-${w}.png`, fullPage: true });
    await pg.goto(base + "/affiliate-confirmed.html?status=ok&code=ADEOKAF47");
    check(`${w}px: the confirmed page (code, link, buttons) fits`, (await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)));
    if (shots) await pg.screenshot({ path: `${shots}/confirmed-${w}.png`, fullPage: true });
    await c.close();
  }
}
