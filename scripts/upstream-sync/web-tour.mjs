// Walk the main web screens of a daemon serving the bundled web UI and save one
// screenshot per screen, for the upstream-sync UI check. Fails on any page error.
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

async function visit(page, path, name, prepare) {
  try {
    await page.goto(base + path);
    await page.waitForTimeout(4500);
    if (prepare) await prepare(page);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`saved ${name}`);
  } catch (error) {
    stepErrors.push(`${name}: ${error.message.split("\n")[0]}`);
  }
}

const desktop = await openPage({});
await visit(desktop, "/", "desktop-home");
await visit(desktop, "/connectors", "connectors");
await visit(desktop, "/automations", "automations-schedules");
await visit(desktop, "/settings/general", "settings-general-language");
await visit(desktop, "/settings/appearance", "settings-appearance");
await visit(desktop, "/settings/sidebar", "settings-sidebar");
await visit(desktop, "/", "create-bot", (page) =>
  page.getByText("Create a bot", { exact: true }).first().click(),
);
await visit(desktop, "/", "add-connection", async (page) => {
  await page.getByTestId("sidebar-hosts-trigger").click();
  await page.getByTestId("sidebar-host-add").click();
});
await visit(desktop, "/settings/general", "home-vietnamese", async (page) => {
  await page.getByText("Tiếng Việt", { exact: true }).first().click();
  await page.goto(base + "/");
  await page.waitForTimeout(4000);
});
await visit(desktop, "/settings/general", "language-reset", (page) =>
  page.getByText("English", { exact: true }).first().click(),
);
await visit(await openPage({ welcome: true }), "/welcome", "welcome");
await visit(
  await openPage({ width: 390, height: 844, welcome: true }),
  "/welcome",
  "welcome-mobile",
);
await visit(await openPage({ width: 390, height: 844 }), "/", "mobile-home");
await visit(await openPage({ colorScheme: "dark" }), "/", "desktop-dark");

await browser.close();
console.log(`page errors: ${pageErrors.length}, steps that failed: ${stepErrors.length}`);
for (const error of [...pageErrors, ...stepErrors]) console.log(`  ${error}`);
process.exit(pageErrors.length + stepErrors.length === 0 ? 0 : 1);
