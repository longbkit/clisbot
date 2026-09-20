import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { expectAppRoute } from "../support/helpers/route-assertions";
import {
  addOfflineHostAndReload,
  addOfflineHostsAndReload,
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
  }) => {
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
      await page
        .getByRole("button", { name: /Open .* settings/ })
        .first()
        .click();
      await expectAppRoute(page, buildSettingsHostSectionRoute(serverId, "host"));
    } finally {
      await seeded.cleanup();
    }
  });

  test("footer host picker searches once there are four hosts", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "host-picker-search-" });

    try {
      await gotoAppShell(page);
      await addOfflineHostsAndReload(page, [
        { serverId: "host-search-two", label: "Search Host Two" },
        { serverId: "host-search-three", label: "Search Host Three" },
        { serverId: "host-search-four", label: "Search Host Four" },
      ]);

      await openSidebarHostPicker(page);
      const search = page.getByPlaceholder("Search hosts");
      await expect(search).toBeVisible({ timeout: 10_000 });
      await search.fill("Four");
      await expect(page.getByTestId("sidebar-host-row-host-search-four")).toBeVisible();
      await expect(page.getByTestId("sidebar-host-row-host-search-two")).toHaveCount(0);
    } finally {
      await seeded.cleanup();
    }
  });
});
