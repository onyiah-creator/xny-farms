export default async function ({ browser, base, check, shots }) {
  for (const [label, width, height, mobile] of [["desktop 1280px", 1280, 800, false], ["phone 375px", 375, 700, true]]) {
    console.log(`-- ${label}`);
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/admin-referrals.html");
    const input = page.locator("#admin-password");
    const button = page.locator(".pw-field .pw-toggle");

    check(`${label}: the input is wrapped and has an eye button`, (await page.locator(".pw-field > #admin-password").count()) === 1 && (await button.count()) === 1);
    check("the toggle is a real <button type=button>", (await button.evaluate((b) => b.tagName === "BUTTON" && b.type === "button")));
    check("starts hidden: type=password, aria-label 'Show password', aria-pressed=false", (await input.getAttribute("type")) === "password" && (await button.getAttribute("aria-label")) === "Show password" && (await button.getAttribute("aria-pressed")) === "false");
    const box = await button.boundingBox();
    check(`touch target is at least 44x44 (${Math.round(box.width)}x${Math.round(box.height)})`, box.width >= 44 && box.height >= 44);
    const ib = await input.boundingBox();
    check("the button sits inside the right edge of the input", box.x + box.width <= ib.x + ib.width + 0.5 && box.x >= ib.x && box.y >= ib.y - 0.5 && box.y + box.height <= ib.y + ib.height + 0.5, JSON.stringify({ box, ib }));
    check("the input's right padding keeps the text clear of the icon", (await input.evaluate((i) => parseFloat(getComputedStyle(i).paddingRight))) >= 44);
    check("the original input kept its id, name and autocomplete (autofill still recognises it)", (await input.getAttribute("name")) === "password" && (await input.getAttribute("autocomplete")) === "current-password");

    // toggle with the mouse, caret preserved
    await input.click();
    await page.keyboard.type("hunter2-secret");
    await input.evaluate((i) => i.setSelectionRange(3, 7));
    await button.click();
    check("click shows the password: type=text, 'Hide password', aria-pressed=true", (await input.getAttribute("type")) === "text" && (await button.getAttribute("aria-label")) === "Hide password" && (await button.getAttribute("aria-pressed")) === "true");
    check("the value is untouched", (await input.inputValue()) === "hunter2-secret");
    const sel = await input.evaluate((i) => [i.selectionStart, i.selectionEnd, document.activeElement === i]);
    check("the caret/selection is where it was (3-7) and the input keeps focus", sel[0] === 3 && sel[1] === 7 && sel[2] === true, JSON.stringify(sel));
    await button.click();
    check("click again hides it", (await input.getAttribute("type")) === "password" && (await button.getAttribute("aria-pressed")) === "false");

    // keyboard
    await input.focus();
    await page.keyboard.press("Tab");
    check("Tab from the input reaches the toggle", await button.evaluate((b) => document.activeElement === b));
    check("keyboard focus shows a visible ring", (await button.evaluate((b) => { const s = getComputedStyle(b); return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2; })));
    await page.keyboard.press("Enter");
    check("Enter on the button toggles it", (await input.getAttribute("type")) === "text");
    await page.keyboard.press("Space");
    check("Space on the button toggles it back", (await input.getAttribute("type")) === "password");

    // never submits the form
    const submitted = await page.evaluate(() => new Promise((resolve) => {
      let fired = false;
      document.getElementById("admin-form").addEventListener("submit", () => { fired = true; });
      document.querySelector(".pw-toggle").click(); document.querySelector(".pw-toggle").click();
      setTimeout(() => resolve(fired), 150);
    }));
    check("toggling never submits the form", submitted === false);

    // reset on submit
    await button.click();
    check("(visible again before submitting)", (await input.getAttribute("type")) === "text");
    await page.click("#admin-submit");
    await page.waitForFunction(() => document.getElementById("admin-status").textContent.length > 0);
    check("submitting the form hides the password again", (await input.getAttribute("type")) === "password" && (await button.getAttribute("aria-pressed")) === "false");

    // reset on clear
    await button.click();
    await input.fill("");
    check("clearing the field hides it again", (await input.getAttribute("type")) === "password" && (await button.getAttribute("aria-label")) === "Show password");

    // another page with a password field
    await page.goto(base + "/admin-approve-affiliate.html");
    check("admin-approve-affiliate.html's password field has the toggle too", (await page.locator("#ap-password").evaluate((i) => i.closest(".pw-field") !== null)));

    // future inputs: added after load, on a page that only loads main.js
    await page.goto(base + "/contact.html");
    check("(a public page has no password field, so no toggle script is loaded yet)", (await page.locator(".pw-toggle").count()) === 0 && (await page.evaluate(() => !window.XNY_PASSWORD_TOGGLE)));
    await page.evaluate(() => { const f = document.createElement("form"); f.innerHTML = '<div class="field"><label for="late">Later</label><input id="late" type="password" autocomplete="new-password"></div>'; document.querySelector("main, body").appendChild(f); });
    await page.waitForSelector("#late", { state: "attached" });
    await page.waitForFunction(() => document.querySelector("#late") && document.querySelector("#late").closest(".pw-field") && document.querySelector("#late").closest(".pw-field").querySelector(".pw-toggle"), null, { timeout: 4000 });
    check("a password input added later to a page that loads main.js gets the toggle automatically", true);
    await page.locator("#late").fill("abc");
    await page.locator("#late").evaluate((i) => i.closest(".pw-field").querySelector(".pw-toggle").click());
    check("...and it works", (await page.locator("#late").getAttribute("type")) === "text");
    check("no script errors", errors.length === 0, errors.join("|"));
    if (shots) { await page.goto(base + "/admin-referrals.html"); await page.locator("#admin-password").fill("example-password"); await page.locator(".pw-toggle").click(); await page.screenshot({ path: `${shots}/password-toggle-${width}.png` }); }
    await context.close();
  }
}
