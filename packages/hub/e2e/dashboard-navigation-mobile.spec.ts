import { expect } from "@playwright/test";
import { test } from "./app.js";
import { projectApp } from "./helpers/projects/index.js";

const SHOTS = "e2e/screenshots/dashboard-navigation-mobile";

const owner = {
  name: "Alice",
  email: "alice-navigation-mobile@example.com",
  password: "alice-navigation-mobile-password",
};

/** The drawer is the product map on mobile, so obsolete project nesting cannot hide here. */
test("shows the flat organization product in the mobile drawer", async ({ hub, page }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  const drawer = page.getByRole("dialog", { name: "Sidebar" });
  const toggle = page.getByRole("button", { name: "Toggle Sidebar" });
  const organizationSwitcher = drawer.getByRole("button", { name: "Organization" });
  await toggle.click();
  const navigation = drawer.getByRole("navigation", { name: "Organization", exact: true });
  await expect(navigation.getByRole("link")).toHaveText([
    "Triggers",
    "Activity",
    "Daemons",
    "Connections",
    "Settings",
  ]);
  await expect(organizationSwitcher).toContainText("Acme");
  await expect(drawer.getByRole("navigation", { name: "Project", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Project", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/01-organization-scope.png` });
});

test.describe("instance scope", () => {
  test("enters instance scope through the drawer's account menu", async ({ hub, page }) => {
    const app = projectApp(page);
    await hub.signUpAs("owner", owner);
    await hub.createOrganization("owner", "Acme");
    await hub.grantOperator("owner");
    const drawer = page.getByRole("dialog", { name: "Sidebar" });
    const instanceNav = drawer.getByRole("navigation", { name: "Instance", exact: true });

    // The account menu opens inside the drawer, so leaving for the
    // instance has to dismiss it — otherwise the operator arrives behind the sidebar.
    await app.navigation.openMobileInstanceSection(owner.email, "Operator");
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading", { name: "Operator", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(instanceNav.getByRole("link")).toHaveText(["Back to Acme", "Apps", "Operator"]);
    await expect(drawer.getByRole("button", { name: "Organization" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/03-instance-scope.png` });

    await app.navigation.leaveInstance();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading", { name: "Triggers" })).toBeVisible();
  });
});
