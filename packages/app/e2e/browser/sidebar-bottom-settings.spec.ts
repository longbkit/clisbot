import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  leaveSettings,
  openSidebarNavSettings,
  setSidebarNavItemVisible,
} from "../support/helpers/sidebar-nav-settings";
import { openMobileAgentSidebar } from "../support/helpers/sidebar";
import { getServerId } from "../support/helpers/server-id";

/** With one ready Host, `useHostChooser` picks it: the sheet opens with no chooser between. */
async function expectImportSheetForTheOnlyHost(page: Page): Promise<void> {
  await expect(page.getByTestId("import-session-sheet")).toBeVisible();
  await expect(page.getByTestId(`host-chooser-row-${getServerId()}`)).toHaveCount(0);
  await expect(page.getByTestId("import-session-scope")).toContainText("localhost");
}

test("bottom actions persist, Help and Settings stay fixed, and New and Search open existing flows", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await gotoAppShell(page);
  const footer = page.locator('[data-testid="sidebar-footer"]:visible').first();
  await expect(footer.getByTestId("sidebar-new")).toBeVisible();
  await expect(footer.getByTestId("sidebar-footer-search")).toBeVisible();
  await expect(footer.getByTestId("sidebar-add-project")).toHaveCount(0);
  await expect(footer.getByTestId("sidebar-import-session")).toHaveCount(0);
  await expect(page.locator('[data-testid="sidebar-nav-add-project"]:visible')).toHaveCount(0);
  await expect(page.locator('[data-testid="sidebar-search"]:visible')).toHaveCount(0);

  await footer.getByTestId("sidebar-new").hover();
  const menu = page.getByTestId("sidebar-new-menu");
  const expectMenuToStayOpen = async (durationMs: number) => {
    expect(
      await menu.evaluate(
        (node, duration) =>
          new Promise<boolean>((resolve) => {
            const started = performance.now();
            const sample = () => {
              if (!node.isConnected || node.getClientRects().length === 0) return resolve(false);
              if (performance.now() - started >= duration) return resolve(true);
              requestAnimationFrame(sample);
            };
            sample();
          }),
        durationMs,
      ),
    ).toBe(true);
  };
  await expect(menu).toBeVisible();
  await expect(menu.getByText("New workspace", { exact: true })).toBeVisible();
  await expect(menu.getByText("New project", { exact: true })).toBeVisible();
  await expect(menu.getByTestId("sidebar-new-bot")).toBeEnabled();
  await expect(menu.getByTestId("sidebar-new-group")).toBeDisabled();
  await expect(menu.getByTestId("sidebar-new-import-session")).toBeVisible();
  // The menu backdrop covers its trigger. Opening must not start a leave/re-enter loop.
  await expectMenuToStayOpen(1_200);
  const triggerBounds = (await footer.getByTestId("sidebar-new").boundingBox())!;
  const menuBounds = (await menu.boundingBox())!;
  // Pause in the visual gap longer than the close grace: the bridge must keep the menu alive.
  await page.mouse.move(
    triggerBounds.x + triggerBounds.width / 2,
    (menuBounds.y + menuBounds.height + triggerBounds.y) / 2,
  );
  await expectMenuToStayOpen(350);
  await menu.getByTestId("sidebar-new-project").hover();
  await expectMenuToStayOpen(350);

  const outside = { x: menuBounds.x + menuBounds.width + 30, y: menuBounds.y + 20 };
  await page.mouse.move(outside.x, outside.y);
  await menu.getByTestId("sidebar-new-workspace").hover();
  await expectMenuToStayOpen(350);
  await page.mouse.move(outside.x, outside.y);
  await expect(menu).toBeHidden();

  await footer.getByTestId("sidebar-new").hover();
  await expect(menu).toBeVisible();
  await menu.getByTestId("sidebar-new-project").hover();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Explicit keyboard opening must survive pointer movement outside the hover region.
  await page.mouse.move(outside.x, outside.y);
  await footer.getByTestId("sidebar-new").focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.mouse.move(outside.x + 10, outside.y);
  await expectMenuToStayOpen(350);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await footer.getByTestId("sidebar-new").hover();
  await expect(menu).toBeVisible();
  await menu.getByTestId("sidebar-new-import-session").click();
  await expectImportSheetForTheOnlyHost(page);
  const importSheet = page.getByTestId("import-session-sheet");
  await importSheet.getByRole("button", { name: "Close", exact: true }).click();

  await footer.getByTestId("sidebar-new").hover();
  await expect(menu).toBeVisible();
  await menu.getByTestId("sidebar-new-bot").click();
  await expect(page.getByRole("textbox", { name: "Bot name", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await footer.getByTestId("sidebar-footer-search").click();
  await expect(page.getByTestId("command-center-input")).toBeFocused();
  await page.getByTestId("command-center-input").fill("workspace");
  await page.keyboard.press("Escape");

  await openSidebarNavSettings(page);
  const bottom = page.getByTestId("sidebar-footer-section");
  // Titled "Bottom bar" since the v0.11.1 sync added upstream's Footer card (merge-v0.11.1.md).
  await expect(bottom.getByText("Bottom bar", { exact: true })).toBeVisible();
  for (const key of ["help", "settings"]) {
    const row = bottom.getByTestId(`sidebar-footer-item-${key}`);
    await expect(row.getByRole("switch")).toBeDisabled();
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect(row.getByRole("button", { name: "Move up", exact: true })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Move down", exact: true })).toBeDisabled();
  }
  await page.screenshot({ path: testInfo.outputPath("sidebar-settings.png") });
  await bottom.getByTestId("sidebar-footer-item-settings").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("sidebar-settings-bottom.png") });

  await setSidebarNavItemVisible(page, "add-project", true);
  await bottom.getByTestId("sidebar-footer-toggle-add-project").click();
  await bottom.getByTestId("sidebar-footer-toggle-import-session").click();
  await bottom.getByTestId("sidebar-footer-move-up-import-session").click();
  await bottom.getByTestId("sidebar-footer-toggle-hosts").click();
  await expect(bottom.getByTestId("sidebar-footer-toggle-hosts")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await leaveSettings(page);
  await expect(footer.getByTestId("sidebar-add-project")).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-nav-add-project"]:visible')).toBeVisible();
  await expect(footer.getByTestId("sidebar-hosts-trigger")).toHaveCount(0);
  await page.reload();
  await expect(footer.getByTestId("sidebar-add-project")).toBeVisible();
  await expect(footer.getByTestId("sidebar-hosts-trigger")).toHaveCount(0);
  await expect(footer.getByTestId("sidebar-help")).toBeVisible();
  await expect(footer.getByTestId("sidebar-settings")).toBeVisible();

  await openSidebarNavSettings(page);
  await bottom.getByTestId("sidebar-footer-toggle-hosts").click();
  await leaveSettings(page);
  const controls = await footer
    .locator(
      '[data-testid="sidebar-import-session"], [data-testid="sidebar-hosts-trigger"], [data-testid="sidebar-help"], [data-testid="sidebar-settings"]',
    )
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
  expect(controls).toEqual([
    "sidebar-import-session",
    "sidebar-hosts-trigger",
    "sidebar-help",
    "sidebar-settings",
  ]);
  await page.screenshot({ path: testInfo.outputPath("sidebar-bottom.png") });

  await footer.getByTestId("sidebar-new").hover();
  await expect(menu).toBeVisible();
  await menu.getByTestId("sidebar-new-workspace").click();
  await expect(page).toHaveURL(/\/new(?:\?|$)/);
});

test.describe("mobile bottom actions", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("footer controls and New actions have 48px touch targets and open by tap", async ({
    page,
  }, testInfo) => {
    await gotoAppShell(page);
    await openMobileAgentSidebar(page);
    const trigger = page.locator('[data-testid="sidebar-new"]:visible').first();
    await expect(trigger).toBeVisible();
    const footer = page.locator('[data-testid="sidebar-footer"]:visible').first();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = [];
      for (const id of [
        "sidebar-new",
        "sidebar-footer-search",
        "sidebar-hosts-trigger",
        "sidebar-help",
        "sidebar-settings",
      ]) {
        const control = footer.getByTestId(id);
        await expect(control).toBeInViewport({ ratio: 1 });
        const target = await control.boundingBox();
        expect(target).not.toBeNull();
        expect(target!.width).toBeGreaterThanOrEqual(48);
        expect(target!.height).toBeGreaterThanOrEqual(48);
        bounds.push(target!);
      }
      for (let i = 0; i < bounds.length; i++) {
        for (let j = i + 1; j < bounds.length; j++) {
          const a = bounds[i]!;
          const b = bounds[j]!;
          const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          expect(overlapWidth <= 0 || overlapHeight <= 0).toBe(true);
        }
      }
      await page.screenshot({ path: testInfo.outputPath(`sidebar-footer-mobile-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.tap({ position: { x: 4, y: 24 } });
    const action = page.getByTestId("sidebar-new-workspace");
    await expect(action).toBeVisible();
    await expect(action).toBeInViewport();
    await expect(page.getByTestId("sidebar-new-project")).toBeVisible();
    await expect(page.getByTestId("sidebar-new-import-session")).toBeInViewport({ ratio: 1 });
    for (const id of [
      "sidebar-new-workspace",
      "sidebar-new-project",
      "sidebar-new-bot",
      "sidebar-new-group",
      "sidebar-new-import-session",
    ]) {
      const target = await page.getByTestId(id).boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(48);
      expect(target?.height).toBeGreaterThanOrEqual(48);
    }
    await page.screenshot({ path: testInfo.outputPath("sidebar-new-mobile.png") });
    await page.getByTestId("sidebar-new-import-session").tap();
    await expectImportSheetForTheOnlyHost(page);
    const importSheet = page.getByTestId("import-session-sheet");
    await importSheet.getByRole("button", { name: "Close", exact: true }).tap();
    await openMobileAgentSidebar(page);
    await trigger.tap();
    await action.tap();
    await expect(page).toHaveURL(/\/new(?:\?|$)/);
  });

  test("touch tablets keep 48px targets with the desktop sidebar layout", async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    await gotoAppShell(page);
    const trigger = page.locator('[data-testid="sidebar-new"]:visible').first();
    await expect(trigger).toBeVisible();
    const target = await trigger.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(48);
    expect(target?.height).toBeGreaterThanOrEqual(48);
    await trigger.tap();
    const action = page.getByTestId("sidebar-new-workspace");
    await expect(action).toBeVisible();
    await expect
      .poll(async () => (await action.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(48);
    await action.tap();
    await expect(page).toHaveURL(/\/new(?:\?|$)/);
  });
});
