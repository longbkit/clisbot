import type { Page } from "@playwright/test";
import { expect, test as base } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  addConnectedHostAndReload,
  chooseHostBadgeDisplay,
  leaveHostAppearanceSettings,
  openHostAppearanceSettings,
  waitForConnectedHost,
} from "../support/helpers/hosts";
import {
  type IsolatedHostDaemon,
  startIsolatedHostDaemon,
} from "../support/helpers/isolated-host-daemon";
import { seedMockAgentWorkspace, type MockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import {
  closeSidebarDisplayPreferences,
  openSidebarDisplayPage,
  selectSidebarGrouping,
} from "../support/helpers/sidebar";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

// The reported screen: two Hosts whose sessions share a title, grouped by Session, Host ticked
// under Display > Show, and no line said which Host a session lives on. A session line stands in
// for its workspace row in the session groupings, so it carries that row's host badge.
const PRIMARY_HOST_LABEL = "Primary Host";
const SECONDARY_HOST_LABEL = "Secondary Host";
const SHARED_TITLE = "Same session title";

interface Sessions {
  primary: { serverId: string; agentId: string };
  secondary: { serverId: string; agentId: string };
}

const test = base.extend<{ sessions: Sessions }>({
  sessions: async ({ page }, provide) => {
    const secondaryHost: IsolatedHostDaemon = await startIsolatedHostDaemon("session-line-host");
    let primary: MockAgentWorkspace | null = null;
    let secondary: MockAgentWorkspace | null = null;
    try {
      primary = await seedMockAgentWorkspace({
        repoPrefix: "session-line-host-primary-",
        title: SHARED_TITLE,
      });
      secondary = await seedMockAgentWorkspace({
        repoPrefix: "session-line-host-secondary-",
        title: SHARED_TITLE,
        port: secondaryHost.port,
      });
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryHost.serverId,
        label: SECONDARY_HOST_LABEL,
        port: secondaryHost.port,
        primaryLabel: PRIMARY_HOST_LABEL,
      });
      await waitForConnectedHost(page, {
        serverId: secondaryHost.serverId,
        endpoint: `localhost:${secondaryHost.port}`,
      });
      await waitForSidebarHydration(page);
      await provide({
        primary: { serverId: getServerId(), agentId: primary.agentId },
        secondary: { serverId: secondaryHost.serverId, agentId: secondary.agentId },
      });
    } finally {
      await primary?.cleanup().catch(() => undefined);
      await secondary?.cleanup().catch(() => undefined);
      await secondaryHost.close().catch(() => undefined);
    }
  },
});

test.describe.configure({ timeout: 180_000 });

function lineBadge(page: Page, session: { serverId: string; agentId: string }) {
  return page
    .getByTestId(`sidebar-workspace-session-${session.agentId}`)
    .getByTestId(`host-badge-${session.serverId}`);
}

async function toggleHostItem(page: Page): Promise<void> {
  await openSidebarDisplayPage(page, "sidebar-display-show");
  await page.getByTestId("sidebar-row-item-host").click();
  await closeSidebarDisplayPreferences(page);
}

/** The badge's name is drawn in full, not ellipsized away or clipped by the rail. */
async function expectNameFits(
  page: Page,
  session: { serverId: string; agentId: string },
  name: string,
) {
  const label = lineBadge(page, session).getByText(name, { exact: true });
  await expect(label).toBeVisible({ timeout: 15_000 });
  const fit = await label.evaluate((element) => ({
    client: element.clientWidth,
    content: element.scrollWidth,
  }));
  expect(fit.client).toBeGreaterThan(0);
  expect(fit.content).toBeLessThanOrEqual(fit.client);
}

test("session lines name their Host in the session groupings", async ({
  page,
  sessions,
}, testInfo) => {
  // Narrow enough that the sidebar rail is tight, wide enough to keep the desktop sidebar.
  await page.setViewportSize({ width: 1024, height: 800 });

  await test.step("with untouched Host settings both Hosts are named", async () => {
    await selectSidebarGrouping(page, "session");
    await closeSidebarDisplayPreferences(page);
    await expectNameFits(page, sessions.primary, PRIMARY_HOST_LABEL);
    await expectNameFits(page, sessions.secondary, SECONDARY_HOST_LABEL);
    await page.screenshot({ path: testInfo.outputPath("session-grouping-hosts.png") });
  });

  await test.step("Display > Show > Host off removes it, on brings it back", async () => {
    await toggleHostItem(page);
    await expect(lineBadge(page, sessions.primary)).toHaveCount(0);
    await expect(lineBadge(page, sessions.secondary)).toHaveCount(0);
    await toggleHostItem(page);
    await expectNameFits(page, sessions.primary, PRIMARY_HOST_LABEL);
    await expectNameFits(page, sessions.secondary, SECONDARY_HOST_LABEL);
  });

  await test.step("an explicit icon or hidden choice is kept", async () => {
    await openHostAppearanceSettings(page, sessions.secondary.serverId);
    await chooseHostBadgeDisplay(page, "Icon only");
    await leaveHostAppearanceSettings(page);
    await expect(lineBadge(page, sessions.secondary)).toBeVisible({ timeout: 15_000 });
    await expect(lineBadge(page, sessions.secondary)).not.toContainText(SECONDARY_HOST_LABEL);
    await openHostAppearanceSettings(page, sessions.primary.serverId);
    await chooseHostBadgeDisplay(page, "Hidden");
    await leaveHostAppearanceSettings(page);
    await expect(lineBadge(page, sessions.primary)).toHaveCount(0, { timeout: 15_000 });
    await openHostAppearanceSettings(page, sessions.primary.serverId);
    await chooseHostBadgeDisplay(page, "Name");
    await leaveHostAppearanceSettings(page);
    await expectNameFits(page, sessions.primary, PRIMARY_HOST_LABEL);
  });

  await test.step("Project › Session and Status › Session lines carry it too", async () => {
    for (const mode of ["projectSession", "status"] as const) {
      await selectSidebarGrouping(page, mode);
      await closeSidebarDisplayPreferences(page);
      await expectNameFits(page, sessions.primary, PRIMARY_HOST_LABEL);
      await expect(lineBadge(page, sessions.secondary)).toBeVisible();
    }
  });
});
