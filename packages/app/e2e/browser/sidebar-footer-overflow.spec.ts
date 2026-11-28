import { expect, test } from "../support/fixtures";
import { addProjectFlow } from "../support/helpers/add-project-flow";
import { gotoAppShell } from "../support/helpers/app";
import {
  chooseFooterOverflowAction,
  expectFooterLine,
  expectFooterMenusInsideViewport,
  expectFooterNeverClipped,
  expectFooterOverflowActions,
  footerOverflowMenu,
  openFooterOverflow,
  seedDockedSidebarWidth,
  watchFooterClipping,
} from "../support/helpers/sidebar-footer-overflow";
import { addOfflineHostsAndReload } from "../support/helpers/hosts";
import { openCompactSidebar } from "../support/helpers/usage-sidebar-item";

import { seedSidebarFooterPreferences } from "../support/helpers/sidebar-nav-settings";

const TOUCH_CONTROL = 48;
function configureFiveActions({ page }: { page: import("@playwright/test").Page }) {
  return seedSidebarFooterPreferences(page, [
    { key: "new", visible: false },
    { key: "search", visible: false },
    { key: "add-project", visible: true },
  ]);
}
const MIN_SIDEBAR_WIDTH = 200;
const ALL_INLINE = [
  "sidebar-add-project",
  "sidebar-usage-icon",
  "sidebar-hosts-trigger",
  "sidebar-help",
  "sidebar-settings",
];
// Keep the touch targets at the same 48pt size as the rest of the Clisbot sidebar.
const NARROW_TOUCH_LINE = [
  "sidebar-add-project",
  "sidebar-hosts-trigger",
  "sidebar-footer-overflow",
  "sidebar-settings",
];

test.describe("Sidebar footer on a touch screen", () => {
  test.beforeEach(configureFiveActions);
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true });

  test("a narrow docked sidebar moves the actions it can't fit behind a caret", async ({
    page,
  }) => {
    await seedDockedSidebarWidth(page, MIN_SIDEBAR_WIDTH);
    await watchFooterClipping(page);
    await gotoAppShell(page);
    await expectFooterLine(page, {
      testIDs: ["sidebar-add-project", "sidebar-footer-overflow", "sidebar-settings"],
      controlSize: TOUCH_CONTROL,
    });
    await expectFooterNeverClipped(page);

    await test.step("Help opens as a page of the overflow menu", async () => {
      await openFooterOverflow(page);
      await expectFooterOverflowActions(page, ["Usage", "Hosts", "Help and support"]);
      await chooseFooterOverflowAction(page, "Help and support");
      await expect(page.getByRole("menuitem", { name: "What's new" })).toBeVisible();
      await expect(page.getByTestId("sidebar-help-menu")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(footerOverflowMenu(page)).toBeHidden();
    });

    await test.step("Usage opens from the overflow menu", async () => {
      await openFooterOverflow(page);
      await chooseFooterOverflowAction(page, "Usage");
      await expect(footerOverflowMenu(page)).toBeHidden();
      await expect(page.getByTestId("usage-modal")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("usage-modal")).toBeHidden();
    });

    await test.step("Add project and Settings shortcuts still work", async () => {
      await page.keyboard.press("ControlOrMeta+o");
      await expect(addProjectFlow(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(addProjectFlow(page)).toBeHidden();
      await page.keyboard.press("ControlOrMeta+,");
      await expect(page).toHaveURL(/\/settings\/general$/);
    });
  });

  test("the default sidebar width keeps all five actions inline", async ({ page }) => {
    await gotoAppShell(page);
    await expectFooterLine(page, { testIDs: ALL_INLINE, controlSize: TOUCH_CONTROL });
  });
});

test.describe("Sidebar footer in a compact overlay narrower than the footer", () => {
  test.beforeEach(configureFiveActions);
  test.use({ viewport: { width: 220, height: 800 }, hasTouch: true });

  test("the overflow menu reaches the hidden actions", async ({ page }) => {
    await watchFooterClipping(page);
    await gotoAppShell(page);
    await openCompactSidebar(page);
    await expectFooterLine(page, {
      testIDs: NARROW_TOUCH_LINE.toReversed(),
      controlSize: TOUCH_CONTROL,
    });
    await expectFooterNeverClipped(page);
    await openFooterOverflow(page);
    await expectFooterOverflowActions(page, ["Usage", "Help and support"]);
    await expectFooterMenusInsideViewport(page);
  });
});

test.describe("Sidebar footer on a short, narrow phone", () => {
  // 164pt for buttons holds Settings, Add project and the caret, so Hosts moves behind it.
  test.beforeEach(configureFiveActions);
  test.use({ viewport: { width: 180, height: 360 }, hasTouch: true });

  test("the overflow Hosts page scrolls to its last host and Add host", async ({ page }) => {
    await gotoAppShell(page);
    await addOfflineHostsAndReload(
      page,
      Array.from({ length: 10 }, (_, index) => ({
        serverId: `overflow-host-${index}`,
        label: `Overflow host ${index}`,
      })),
    );
    await openCompactSidebar(page);
    await expectFooterLine(page, {
      testIDs: ["sidebar-settings", "sidebar-footer-overflow", "sidebar-add-project"],
      controlSize: TOUCH_CONTROL,
    });
    await openFooterOverflow(page);
    await expectFooterOverflowActions(page, ["Usage", "Hosts", "Help and support"]);
    await expectFooterMenusInsideViewport(page);
    await chooseFooterOverflowAction(page, "Hosts");
    const lastHost = page.getByTestId("sidebar-host-row-overflow-host-9");
    await lastHost.scrollIntoViewIfNeeded();
    await expect(lastHost).toBeInViewport();
    await lastHost.click();
    await openFooterOverflow(page);
    await chooseFooterOverflowAction(page, "Hosts");
    await expect(
      page.getByRole("button", { name: "Open Overflow host 9 settings", exact: true }),
    ).toBeAttached();
    const addHost = page.getByTestId("sidebar-host-add");
    await addHost.scrollIntoViewIfNeeded();
    await expect(addHost).toBeInViewport();
    await addHost.click();
    await expect(page.getByText("Add connection", { exact: true })).toBeVisible();
  });
});

test.describe("Default Clisbot footer", () => {
  test.use({ viewport: { width: 200, height: 700 }, hasTouch: true });
  test("keeps New visible and Search reachable when space runs out", async ({ page }) => {
    await watchFooterClipping(page);
    await gotoAppShell(page);
    await openCompactSidebar(page);
    await expect(page.getByTestId("sidebar-new")).toBeInViewport();
    await openFooterOverflow(page);
    await chooseFooterOverflowAction(page, "Search");
    await expect(page.getByTestId("command-center-input")).toBeVisible();
    await expectFooterNeverClipped(page);
  });
});
