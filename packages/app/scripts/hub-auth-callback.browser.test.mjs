import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

const html = readFileSync(new URL("../public/hub-auth-callback.html", import.meta.url), "utf8");

test("real browser returns the Hub code after a provider severs the popup opener", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const state = "s".repeat(43);
    const callback = `https://app.clisbot.com/hub-auth-callback?state=${state}&iss=https%3A%2F%2Fwork.test&code=one-use-code`;
    // All origins are intercepted in this isolated context. No production request is made.
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "https://work.test")
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          headers: { "cross-origin-opener-policy": "same-origin" },
          body: `<button id="finish">Finish provider login</button><script>document.querySelector('button').onclick = () => location.href = ${JSON.stringify(callback)}</script>`,
        });
      if (url.pathname === "/hub-auth-callback")
        return route.fulfill({ status: 200, contentType: "text/html", body: html });
      if (url.origin === "https://app.clisbot.com")
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<button id="login">Sign in</button><script>
          const channel = new BroadcastChannel('clisbot-hub-login:${state}');
          channel.onmessage = event => { window.result = event.data.url; channel.close(); };
          document.querySelector('button').onclick = () => { window.popup = window.open('https://work.test/'); };
        </script>`,
        });
      return route.abort();
    });
    const app = await context.newPage();
    await app.goto("https://app.clisbot.com/");
    const opened = context.waitForEvent("page");
    await app.click("#login");
    const popup = await opened;
    await popup.waitForSelector("#finish");
    assert.equal(await popup.evaluate(() => window.opener === null), true);
    await popup.click("#finish");
    await app.waitForFunction(() => typeof window.result === "string");
    assert.equal(await app.evaluate(() => window.result), callback);
    await popup.waitForFunction(() => location.search === "");
    assert.match(await popup.locator("#status").textContent(), /return to Clisbot/);
  } finally {
    await browser.close();
  }
});
