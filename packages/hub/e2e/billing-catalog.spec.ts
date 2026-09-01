import { test } from "./app.js";

const SLICE_5_DIR = "e2e/screenshots/slice-5";

test("billing plans exist only when the instance has a Stripe catalog", async ({ hub, page }) => {
  await test.step("the public plans endpoint 404s as if it were never registered", async () => {
    await hub.expectPublicBillingPlansUnavailableWhenUnconfigured();
    await hub.visitPublicBillingPlans();
    await page.screenshot({
      path: `${SLICE_5_DIR}/01-unconfigured-plans-unavailable.png`,
      fullPage: true,
    });
  });

  await test.step("the public plans endpoint serves the fixture catalog, surviving a rejected edit", async () => {
    const origin = await hub.proveStripePlanCatalogMirror();
    await hub.visitPublicBillingPlans(origin);
    await page.screenshot({
      path: `${SLICE_5_DIR}/02-configured-plan-catalog.png`,
      fullPage: true,
    });
  });
});
