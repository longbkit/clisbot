import { test } from "./app.js";
import { expect } from "@playwright/test";
import { expectMobileOverlayDismissed } from "./helpers/projects/assertions.js";
import { projectApp } from "./helpers/projects/index.js";

const owner = {
  name: "Alice",
  email: "alice-mobile-projects@example.com",
  password: "alice-mobile-projects-password",
};

test("project read failure remains focused and contained on mobile", async ({ hub, page }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.primaryApplication().failNextProjectRead();

  await page.getByRole("link", { name: "Default" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Project unavailable");
  await expect(alert).toContainText(
    "Hub couldn't load this project's configuration. Reload the page to try again.",
  );
  await expect(alert).toBeInViewport();
});

test("dismisses the mobile project navigation overlay and keeps the route within the viewport", async ({
  hub,
  page,
}) => {
  const app = projectApp(page);
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await app.navigation.openProject("Default");
  await app.navigation.openMobileProjectSection("Configuration");
  await expectMobileOverlayDismissed(page);
});
