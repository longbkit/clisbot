import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { getServerId } from "../support/helpers/server-id";
import { TEST_HOST_LABEL } from "../support/helpers/daemon-registry";
import { buildHubSettingsRoute } from "@/clisbot/hub/navigation";
import { getE2EDaemonPort, wsRoutePatternForPort } from "../support/helpers/daemon-port";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import {
  addDirectHostFromSettings,
  clickSettingsBackToWorkspace,
  openSettingsHostSection,
} from "../support/helpers/settings";
import { seedWorkspace } from "../support/helpers/seed-client";
import { switchWorkspaceViaSidebar } from "../support/helpers/workspace-ui";

test.describe("Settings host selection", () => {
  test.describe.configure({ timeout: 180_000 });

  test("shows Hosts before the Host selector and searches with a single Host without Hub sign-in", async ({
    page,
  }, testInfo) => {
    await gotoAppShell(page);
    await openSettings(page);
    const hosts = page.getByTestId("settings-hosts");
    const picker = page.getByTestId("settings-host-picker");
    await expect(hosts).toContainText("Hosts");
    await expect(hosts.getByLabel("1 online out of 1 Hosts")).toHaveText("1/1");
    const hostsBounds = await hosts.boundingBox();
    const pickerBounds = await picker.boundingBox();
    expect(hostsBounds).not.toBeNull();
    expect(pickerBounds).not.toBeNull();
    expect(hostsBounds!.y).toBeLessThan(pickerBounds!.y);

    await hosts.click();
    await expectAppRoute(page, buildHubSettingsRoute("hosts"));
    const list = page.getByTestId("settings-hosts-list");
    await expect(list).toContainText(TEST_HOST_LABEL);
    await expect(list.getByText("Online", { exact: true })).toBeVisible();
    await expect(list.getByLabel("1 online out of 1 Hosts")).toHaveText("1 active / 1 total");
    await expect(page.getByTestId("settings-detail-header-title")).toHaveText("Hosts");
    await expect(list).toContainText(`Host ID: ${getServerId()}`);
    await testInfo.attach("hosts-settings", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    await picker.click();
    const search = page.getByPlaceholder("Search hosts");
    await expect(search).toBeVisible();
    await search.fill("no matching environment");
    await expect(page.getByTestId(`settings-host-picker-item-${getServerId()}`)).toHaveCount(0);
    await search.fill(getServerId());
    await expect(page.getByTestId(`settings-host-picker-item-${getServerId()}`)).toContainText(
      `Host ID: ${getServerId()}`,
    );
    await expect(
      page.getByTestId(`settings-host-picker-item-${getServerId()}`),
    ).toHaveAccessibleName(`${TEST_HOST_LABEL}, Online, Host ID: ${getServerId()}`);
    await expect(
      page
        .getByTestId(`settings-host-picker-item-${getServerId()}`)
        .getByRole("img", { name: "Online", exact: true }),
    ).toBeVisible();
    await testInfo.attach("settings-host-search", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");
    await expect(search).not.toBeVisible();
  });

  test("entering Settings from a remote workspace selects that remote host", async ({ page }) => {
    const remoteDaemon = await startIsolatedHostDaemon("settings-host-selection-remote");
    const remoteWorkspace = await seedWorkspace({
      port: remoteDaemon.port,
      repoPrefix: "settings-host-selection-remote-workspace-",
      title: "Remote workspace",
    });

    try {
      // The default local profile remains in the registry, but its daemon is offline.
      await page.routeWebSocket(wsRoutePatternForPort(getE2EDaemonPort()), async (ws) => {
        await ws.close({ code: 1008, reason: "The local daemon is disconnected." });
      });

      await page.goto("/");
      await openSettings(page);
      await addDirectHostFromSettings(page, {
        host: "127.0.0.1",
        port: remoteDaemon.port,
      });

      await clickSettingsBackToWorkspace(page);
      await switchWorkspaceViaSidebar({
        page,
        serverId: remoteDaemon.serverId,
        workspaceId: remoteWorkspace.workspaceId,
      });

      await openSettings(page);

      await openSettingsHostSection(page, remoteDaemon.serverId, "connections");
    } finally {
      await remoteWorkspace.cleanup().catch(() => undefined);
      await remoteDaemon.close().catch(() => undefined);
    }
  });
});
