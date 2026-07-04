// E2E: the built-in web demo in a real browser (system Chrome via
// playwright-core). Asserts the session list, the replayed conversation, and
// a live SSE completion arriving while the page is open — and captures the
// review evidence screenshots as test artifacts.
//
// Skips truthfully when no system Chrome is available (CI without a browser).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import {
  startWebDemoServer,
  WEB_DEMO_FINAL_REPLY,
  WEB_DEMO_FOLLOWED_SESSION,
  type WebDemoServer,
} from "./support/web-demo-server.ts";

const SCREENSHOT_DIR = join(
  import.meta.dir,
  "..",
  "docs",
  "artifacts",
  "2026-07-03-runner-backend-review",
  "evidence",
  "images",
);

let browser: Browser | null = null;
let server: WebDemoServer | null = null;
let launchError = "";

beforeAll(async () => {
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch (error) {
    launchError = error instanceof Error ? error.message : String(error);
    return;
  }
  server = await startWebDemoServer();
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

afterAll(async () => {
  await browser?.close();
  await server?.stop();
});

function requireBrowser(): { browser: Browser; server: WebDemoServer } | null {
  if (!browser || !server) {
    console.warn(`web demo e2e skipped: system Chrome unavailable (${launchError})`);
    return null;
  }
  return { browser, server };
}

async function openDemo(page: Page, url: string) {
  await page.goto(url);
  await page.waitForSelector(".session .key", { timeout: 10_000 });
}

describe("web demo e2e (real browser over SSE)", () => {
  test("lists sessions from every channel with truthful runtime states", async () => {
    const env = requireBrowser();
    if (!env) return;
    const page = await env.browser.newPage({ viewport: { width: 1440, height: 900 } });

    await openDemo(page, env.server.demoUrl);

    const keys = await page.locator(".session .key").allTextContents();
    expect(keys.some((key) => key.includes("slack:group:C042"))).toBe(true);
    expect(keys.some((key) => key.includes("telegram:topic:-1002"))).toBe(true);
    expect(keys.some((key) => key.includes("api:dm:3:970"))).toBe(true);
    expect(await page.locator(".session .state-running").first().isVisible()).toBe(true);
    expect(await page.locator(".session .state-detached").first().isVisible()).toBe(true);
    expect(await page.locator(".session .state-idle").first().isVisible()).toBe(true);
    await page.close();
  });

  test("replays the conversation, streams a live completion, and captures evidence screenshots", async () => {
    const env = requireBrowser();
    if (!env) return;
    const page = await env.browser.newPage({ viewport: { width: 1440, height: 900 } });

    await openDemo(page, env.server.demoUrl);
    // ?follow=first auto-opens the Slack-origin session: replayed history.
    await page.waitForSelector(".entry", { timeout: 10_000 });
    const replayed = await page.locator("#stream").innerText();
    expect(replayed).toContain("Review the failing checkout test");
    expect(replayed).toContain("permission-request");
    expect(replayed).toContain("Edit src/pricing/discount.ts");
    expect(replayed).toContain("plan");
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "web-demo-replay.png"),
    });

    // A completion published AFTER the page connected must arrive live.
    env.server.publishCompletion();
    await page.waitForFunction(
      `document.getElementById("stream").innerText.includes(${JSON.stringify(WEB_DEMO_FINAL_REPLY)})`,
      undefined,
      { timeout: 10_000 },
    );
    const finalText = await page.locator("#stream").innerText();
    expect(finalText).toContain("All 34 checkout tests pass");
    expect(finalText).toContain("run completed");
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "web-demo-live-completion.png"),
    });
    await page.close();
  });

  test("renders usably on a phone viewport", async () => {
    const env = requireBrowser();
    if (!env) return;
    const page = await env.browser.newPage({ viewport: { width: 430, height: 900 } });

    await openDemo(page, env.server.demoUrl);
    await page.waitForSelector(".entry", { timeout: 10_000 });
    expect(
      await page
        .locator(`.session .key:has-text("${WEB_DEMO_FOLLOWED_SESSION.sessionKey.slice(0, 20)}")`)
        .count(),
    ).toBeGreaterThan(0);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "web-demo-mobile.png"),
    });
    await page.close();
  });

  test("rejects a wrong token in the browser flow", async () => {
    const env = requireBrowser();
    if (!env) return;
    const page = await env.browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto(env.server.demoUrl.replace("token=demo-token", "token=wrong"));
    await page.waitForSelector("#sessions .session", { timeout: 10_000 });
    const listText = await page.locator("#sessions").innerText();
    expect(listText).toContain("Error 401");
    await page.close();
  });
});
