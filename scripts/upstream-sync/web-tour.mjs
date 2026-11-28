// Walk the main web screens of a daemon serving the bundled web UI and save one
// screenshot per screen, for the upstream-sync UI check. Each screen waits for its own content;
// a page error, a missing marker, a blank capture or a failed action exits non-zero.
//
// Usage (from the repo root, after `npm run build:daemon-web-ui` and starting a
// daemon with CLISBOT_WEB_UI_ENABLED=true):
//   node scripts/upstream-sync/web-tour.mjs --url http://127.0.0.1:6961 --out <dir>
//
// Screens that show account data (Usage) are left out on purpose: the
// screenshots end up in audits.
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values } = parseArgs({
  options: { url: { type: "string" }, out: { type: "string" } },
});
const base = values.url ?? "http://127.0.0.1:6961";
const out = values.out ?? ".debug/scratch/web-tour";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const pageErrors = [];
const stepErrors = [];

async function openPage({ width = 1440, height = 900, colorScheme = "light", welcome = false }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(`${page.url()}: ${error.message}`));
  if (welcome) {
    // The served HTML points the app at its own daemon; drop that to reach Welcome.
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const response = await route.fetch();
      const body = (await response.text()).replace(
        /window\.__CLISBOT_INITIAL_DAEMON_CONNECTION__=[^;]*;/u,
        "",
      );
      return route.fulfill({ response, body });
    });
  }
  return page;
}

/**
 * One screen: open `path`, wait for `ready` (text that only this screen shows), run `prepare`,
 * wait for `shows` (what the step should leave on screen), then screenshot. A step passes only
 * when that content is visible and the capture is not blank; a missing marker, a blank page or
 * a failed action fails the step and the tour exits non-zero.
 */
async function visit(page, path, name, { ready, prepare, shows } = {}) {
  try {
    await page.goto(base + path);
    if (ready) await expectVisible(page, ready);
    if (prepare) await prepare(page);
    if (shows) await expectVisible(page, shows);
    await page.waitForTimeout(800);
    const text = (await page.evaluate(() => document.body.innerText)).trim();
    if (text.length < 40) throw new Error(`page shows almost no text (${text.length} chars)`);
    const image = await page.screenshot({ path: `${out}/${name}.png` });
    if (image.length < 15_000) throw new Error(`screenshot looks blank (${image.length} bytes)`);
    console.log(`saved ${name} (${image.length} bytes)`);
  } catch (error) {
    stepErrors.push(`${name}: ${error.message.split("\n")[0]}`);
  }
}

/** `marker` is visible text, or a function of the page that resolves once the screen is right. */
async function expectVisible(page, marker) {
  if (typeof marker === "function") return marker(page);
  await page
    .getByText(marker, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

const desktop = await openPage({});
await visit(desktop, "/", "desktop-home", { ready: "Quick start" });
await visit(desktop, "/connectors", "connectors", { ready: "All apps" });
await visit(desktop, "/automations", "automations-schedules", { ready: "What is a Hub?" });
await visit(desktop, "/settings/general", "settings-general-language", { ready: "App language" });
await visit(desktop, "/settings/appearance", "settings-appearance", { ready: "Interface font" });
await visit(desktop, "/settings/sidebar", "settings-sidebar", { ready: "Sidebar view" });
// Bots are created from Chats → New chat → New bot (the Home "Create bot" button is gone).
await visit(desktop, "/chat", "create-bot", {
  ready: (page) => page.getByRole("button", { name: "New chat" }).first().waitFor(),
  prepare: async (page) => {
    await page.getByRole("button", { name: "New chat" }).first().click();
    await page.getByRole("menuitem", { name: "New bot" }).click();
  },
  shows: "AI configuration",
});
await visit(desktop, "/", "add-connection", {
  ready: "Quick start",
  prepare: async (page) => {
    await page.getByTestId("sidebar-hosts-trigger").click();
    await page.getByTestId("sidebar-host-add").click();
  },
  shows: (page) => page.getByRole("dialog").first().waitFor({ state: "visible" }),
});
await visit(desktop, "/settings/general", "home-vietnamese", {
  ready: "App language",
  prepare: async (page) => {
    await page.getByText("Tiếng Việt", { exact: true }).first().click();
    await page.goto(base + "/");
  },
  // Home in Vietnamese: no English "Quick start", and Vietnamese text on screen.
  shows: (page) =>
    page.waitForFunction(
      () =>
        !document.body.innerText.includes("Quick start") &&
        /[ăâđêôơư]/iu.test(document.body.innerText),
      undefined,
      { timeout: 30_000 },
    ),
});
await visit(desktop, "/settings/general", "language-reset", {
  prepare: (page) => page.getByText("English", { exact: true }).first().click(),
  shows: "App language",
});
const welcomeShown = (page) =>
  page.waitForFunction(
    () => location.pathname.startsWith("/welcome") && document.body.innerText.trim().length > 40,
    undefined,
    { timeout: 30_000 },
  );
await visit(await openPage({ welcome: true }), "/welcome", "welcome", { ready: welcomeShown });
await visit(
  await openPage({ width: 390, height: 844, welcome: true }),
  "/welcome",
  "welcome-mobile",
  {
    ready: welcomeShown,
  },
);
await visit(await openPage({ width: 390, height: 844 }), "/", "mobile-home", {
  ready: "Quick start",
});
await visit(await openPage({ colorScheme: "dark" }), "/", "desktop-dark", { ready: "Quick start" });

await browser.close();
console.log(`page errors: ${pageErrors.length}, steps that failed: ${stepErrors.length}`);
for (const error of [...pageErrors, ...stepErrors]) console.log(`  ${error}`);
process.exit(pageErrors.length + stepErrors.length === 0 ? 0 : 1);
