import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { expectAppRoute } from "../support/helpers/route-assertions";
import {
  addOfflineHostAndReload,
  expectHostFilterRow,
  openSidebarHostFilter,
  openSidebarHostPicker,
  selectAllHostsFilter,
  selectSidebarHostPickerHost,
  toggleHostFilter,
} from "../support/helpers/hosts";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { buildHubSettingsRoute } from "@/clisbot/hub/navigation";
import { clickSettingsBackToWorkspace } from "../support/helpers/settings";

const SECONDARY_HOST_ID = "host-filter-secondary";

test.describe("Sidebar host filter (multi-select)", () => {
  test.describe.configure({ timeout: 120_000 });

  test("pins the sidebar to multiple selected hosts at once", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "host-filter-" });
    const serverId = getServerId();
    const workspaceRow = page.getByTestId(
      `sidebar-workspace-row-${serverId}:${seeded.workspaceId}`,
    );

    try {
      // A second (offline) host is enough to surface the host filter without a second daemon.
      await gotoAppShell(page);
      await addOfflineHostAndReload(page, { serverId: SECONDARY_HOST_ID, label: "Secondary Host" });
      await expect(workspaceRow).toBeVisible({ timeout: 30_000 });

      await openSidebarHostFilter(page);
      await expectHostFilterRow(page, serverId);
      await expectHostFilterRow(page, SECONDARY_HOST_ID);

      // Pin the primary host — its workspace stays visible.
      await toggleHostFilter(page, serverId);
      await expect(workspaceRow).toBeVisible();

      // Add the secondary host without clearing the primary. Under single-select this would replace
      // the primary and hide the workspace; multi-select keeps both pinned, so it stays visible.
      await toggleHostFilter(page, SECONDARY_HOST_ID);
      await expect(workspaceRow).toBeVisible();

      // Drop the primary host — only the (empty) secondary host remains pinned, so the workspace hides.
      await toggleHostFilter(page, serverId);
      await expect(workspaceRow).toHaveCount(0, { timeout: 10_000 });

      // Back to all hosts — the workspace returns.
      await selectAllHostsFilter(page);
      await expect(workspaceRow).toBeVisible({ timeout: 10_000 });
    } finally {
      await seeded.cleanup();
    }
  });

  test("footer host picker filters the sidebar and opens settings from the gear", async ({
    page,
  }, testInfo) => {
    const seeded = await seedWorkspace({ repoPrefix: "host-picker-filter-" });
    const serverId = getServerId();
    const workspaceRow = page.getByTestId(
      `sidebar-workspace-row-${serverId}:${seeded.workspaceId}`,
    );
    const filterIndicator = page.getByTestId("sidebar-hosts-filter-indicator");

    try {
      await gotoAppShell(page);
      await addOfflineHostAndReload(page, { serverId: SECONDARY_HOST_ID, label: "Secondary Host" });
      await expect(workspaceRow).toBeVisible({ timeout: 30_000 });
      await expect(filterIndicator).toHaveCount(0);

      await openSidebarHostPicker(page);
      await expect(page.getByTestId("sidebar-host-row-__all_hosts__")).toBeVisible();
      await expect(
        page.getByTestId("sidebar-host-row-__all_hosts__").getByLabel("1 online out of 2 Hosts"),
      ).toHaveText("1/2");
      const onlineDot = page
        .getByTestId(`sidebar-host-row-${serverId}`)
        .getByRole("img", { name: "Online", exact: true });
      const inactiveDot = page
        .getByTestId(`sidebar-host-row-${SECONDARY_HOST_ID}`)
        .getByRole("img", { name: /Connecting|Offline|Error/ });
      await expect(onlineDot).toBeVisible();
      await expect(inactiveDot).toBeVisible();
      const onlineColor = await onlineDot.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await expect(inactiveDot).not.toHaveCSS("background-color", onlineColor);
      await expect(page.getByTestId(`sidebar-host-row-${serverId}`)).toContainText(
        `Host ID: ${serverId}`,
      );
      await expect(page.getByTestId(`sidebar-host-row-${SECONDARY_HOST_ID}`)).toContainText(
        `Host ID: ${SECONDARY_HOST_ID}`,
      );
      await testInfo.attach("host-picker-states", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await selectSidebarHostPickerHost(page, SECONDARY_HOST_ID);

      await expect(workspaceRow).toHaveCount(0, { timeout: 10_000 });
      await expect(filterIndicator).toBeVisible();
      await expect(page.getByTestId("sidebar-display-filter-indicator")).toBeVisible();
      await expect(page.getByTestId(`sidebar-filter-chip-host-${SECONDARY_HOST_ID}`)).toBeVisible();
      await expect(page.getByTestId("sidebar-active-filters-clear")).toBeVisible();
      await expect(page).not.toHaveURL(/\/settings(\/|$)/);

      await page.getByTestId("sidebar-active-filters-clear").click();
      await expect(workspaceRow).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("sidebar-display-filter-indicator")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-active-filters")).toHaveCount(0);
      await expect(filterIndicator).toHaveCount(0);

      await openSidebarHostPicker(page);
      await selectSidebarHostPickerHost(page, SECONDARY_HOST_ID);
      await expect(filterIndicator).toBeVisible();
      await expect(workspaceRow).toHaveCount(0);
      await openSidebarHostPicker(page);
      await page
        .getByTestId("sidebar-host-row-__all_hosts__")
        .getByRole("button", { name: "Open All hosts settings", exact: true })
        .click();
      await expectAppRoute(page, buildHubSettingsRoute("hosts"));
      await expect(
        page.getByTestId("settings-hosts").getByLabel("1 online out of 2 Hosts"),
      ).toHaveText("1/2");
      await expect(page.getByTestId("settings-hosts-list")).toContainText("Secondary Host");
      await expect(page.getByTestId("settings-hosts-list")).toContainText("1 active / 2 total");
      await expect(page.getByPlaceholder("Search hosts")).not.toBeVisible();
      await clickSettingsBackToWorkspace(page);
      await expect(filterIndicator).toBeVisible();
      await expect(workspaceRow).toHaveCount(0);
      await page.getByTestId("sidebar-active-filters-clear").click();
      await expect(workspaceRow).toBeVisible();

      await openSidebarHostPicker(page);
      await page
        .getByTestId(`sidebar-host-row-${serverId}`)
        .getByRole("button", { name: /Open .* settings/ })
        .click();
      await expectAppRoute(page, buildSettingsHostSectionRoute(serverId, "host"));
    } finally {
      await seeded.cleanup();
    }
  });

  test("footer host picker always searches, including with one or two hosts", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "host-picker-search-" });

    try {
      await gotoAppShell(page);
      await openSidebarHostPicker(page);
      await expect(page.getByPlaceholder("Search hosts")).toBeVisible();
      await expect(
        page
          .getByTestId("sidebar-host-row-__all_hosts__")
          .getByRole("button", { name: "Open All hosts settings", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await addOfflineHostAndReload(page, {
        serverId: "host-search-two",
        label: "localhost",
      });

      await openSidebarHostPicker(page);
      const search = page.getByPlaceholder("Search hosts");
      await expect(search).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId(`sidebar-host-row-${getServerId()}`)).toHaveAccessibleName(
        `localhost, Online, Host ID: ${getServerId()}`,
      );
      await expect(page.getByTestId("sidebar-host-row-host-search-two")).toHaveAccessibleName(
        /^localhost, (Connecting|Offline|Error), Host ID: host-search-two$/,
      );
      await search.fill("Two");
      await expect(page.getByTestId("sidebar-host-row-host-search-two")).toBeVisible();
      await expect(page.getByTestId(`sidebar-host-row-${getServerId()}`)).toHaveCount(0);
    } finally {
      await seeded.cleanup();
    }
  });
});
