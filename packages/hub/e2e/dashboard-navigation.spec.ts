import { expect } from "@playwright/test";
import { test } from "./app.js";
import { projectApp } from "./helpers/projects/index.js";

const SHOTS = "e2e/screenshots/dashboard-navigation";

const owner = {
  name: "Alice",
  email: "alice-navigation@example.com",
  password: "alice-navigation-password",
};

/** Projects are a runtime compatibility detail, not a concept in the hosted product navigation. */
test("keeps every daily surface at organization scope", async ({ hub, page }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");

  const organizationNav = page.getByRole("navigation", { name: "Organization", exact: true });
  const organizationSwitcher = page.getByRole("button", { name: "Organization" });
  await expect(organizationNav.getByRole("link")).toHaveText([
    "Triggers",
    "Activity",
    "Daemons",
    "Connections",
    "Settings",
  ]);
  await expect(page.getByRole("navigation", { name: "Project", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Project", exact: true })).toHaveCount(0);
  await expect(organizationSwitcher).toContainText("Acme");
  await expect(page.getByRole("heading", { name: "Triggers", level: 1 })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-organization-scope.png`, fullPage: true });
});

test("groups organization administration under one Settings entry", async ({ hub, page }) => {
  const app = projectApp(page);
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");

  const settingsNav = page.getByRole("navigation", { name: "Organization settings" });

  await test.step("Settings lands on Team and shows the sections it owns", async () => {
    await app.navigation.openOrganizationSection("Settings");
    await expect(page).toHaveURL(/\/o\/[^/]+\/settings\/team$/u);
    // Billing is absent: this instance is not billing-configured.
    await expect(settingsNav.getByRole("link")).toHaveText(["Team", "API keys", "Usage"]);
    await expect(page.getByRole("heading", { name: "Team", exact: true, level: 1 })).toBeVisible();
    await app.navigation.expectBreadcrumb("Acme", "Settings", "Team");
    await page.screenshot({ path: `${SHOTS}/03-settings-team.png`, fullPage: true });
  });

  await test.step("Usage is a settings section, not a top-level destination", async () => {
    await expect(
      page
        .getByRole("navigation", { name: "Organization", exact: true })
        .getByRole("link", { name: "Usage" }),
    ).toHaveCount(0);
    await app.navigation.openOrganizationSettings("Usage");
    await expect(page).toHaveURL(/\/o\/[^/]+\/settings\/usage$/u);
    await expect(page.getByRole("heading", { name: "Usage", exact: true, level: 1 })).toBeVisible();
    // Settings stays lit while any section beneath it is open.
    await expect(
      page
        .getByRole("navigation", { name: "Organization", exact: true })
        .getByRole("link", { name: "Settings" }),
    ).toHaveAttribute("aria-current", "page");
    await page.screenshot({ path: `${SHOTS}/04-settings-usage.png`, fullPage: true });
  });
});

test.describe("instance scope", () => {
  /**
   * The instance is not a tenant: `is_instance_operator` belongs to the user, so no place in the
   * organization sidebar would be true. It enters through the account menu, and once
   * entered it is a scope of its own — its own header, its own destinations, its own way back.
   */
  test("enters instance scope from the organization account menu", async ({ hub, page }) => {
    const app = projectApp(page);
    await hub.signUpAs("owner", owner);
    await hub.createOrganization("owner", "Acme");
    await hub.grantOperator("owner");

    const instanceNav = page.getByRole("navigation", { name: "Instance", exact: true });

    await test.step("the instance is nowhere in the tenant sidebar", async () => {
      await expect(instanceNav).toHaveCount(0);
    });

    await test.step("the account menu carries it, because the operator flag is theirs", async () => {
      const menu = await app.navigation.openAccountMenu(owner.email);
      await expect(menu.getByRole("menuitem", { name: "Instance administration" })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/06-account-menu-instance.png`, fullPage: true });
      await page.keyboard.press("Escape");
    });

    await test.step("instance scope replaces the tenant sidebar entirely", async () => {
      await app.navigation.openInstanceSection(owner.email, "Operator");
      await expect(page).toHaveURL(/\/operator$/u);
      await expect(page.getByRole("navigation", { name: "Organization", exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole("navigation", { name: "Project", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Organization" })).toHaveCount(0);
      await expect(instanceNav.getByRole("link")).toHaveText(["Back to Acme", "Apps", "Operator"]);
      await app.navigation.expectBreadcrumb("Instance", "Operator");
      // Shoot the loaded page, not its skeletons: the organization picker is the panel's own
      // proof that its data arrived.
      await expect(page.getByRole("combobox", { name: "Manage organization" })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/07-instance-scope.png`, fullPage: true });
    });

    await test.step("the back row names the organization it returns to", async () => {
      await app.navigation.leaveInstance();
      await expect(page.getByRole("heading", { name: "Triggers" })).toBeVisible();
      await expect(instanceNav).toHaveCount(0);
      await expect(
        page.getByRole("navigation", { name: "Organization", exact: true }),
      ).toBeVisible();
    });
  });
});
