import { test } from "./app.js";

// The paywall is the one surface a customer meets before they have decided to trust the product,
// and on a phone it is a modal inside a modal-shaped shell. This journey locks the two things
// that break there: the picker must not push the page sideways, and the paid plan's call to
// action must be reachable and accessible at phone width — not stranded below three tall cards.

const owner = {
  name: "Nadia",
  email: "nadia-mobile-billing@example.com",
  password: "nadia-mobile-billing-password",
};

const SCREENSHOT_DIR = "e2e/screenshots/billing-mobile";

test.use({ billing: true });

test("the cardless trial can be started and read on a phone", async ({ hub, page }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");

  await test.step("the plan picker fits the viewport and offers the trial", async () => {
    await hub.expectPlanPickerFitsPhone("owner");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-plan-picker.png`, fullPage: true });
  });

  await test.step("starting the trial leaves a readable trial card behind", async () => {
    await hub.choosePlan("owner", "Paseo Hub");
    await hub.deliverSubscriptionWebhook("owner");
    await hub.expectActiveTrial("owner");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-active-trial.png`, fullPage: true });
  });
});
