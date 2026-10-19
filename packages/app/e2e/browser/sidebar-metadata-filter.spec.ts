import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { expect, test, type Page } from "../support/fixtures";
import { createTempDirectory } from "../support/helpers/workspace";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { openProjectDirectoryWithHosts } from "../support/helpers/project-grouping";
import { addConnectedHostsAndReload } from "../support/helpers/hosts";
import { openMobileAgentSidebar } from "../support/helpers/sidebar";

const actors: SessionActor[] = Array.from({ length: 80 }, (_, index) => ({
  kind: "user",
  id: `slack:filter-user-${index}`,
  displayName: `Test user ${String(index).padStart(2, "0")}`,
  hubOrigin: "https://filter-fixture.example",
  organizationId: "filter-org",
  connectionId: "filter-slack",
}));
actors[0].displayName = "Hồ Thị Thanh Nga";
actors[79].displayName = "Văn Đặng";

// Seed persisted records before boot. The real daemon publishes the directory over its real
// connection; neither browser stores nor transport responses are replaced.
async function seedDirectory(home: string): Promise<void> {
  const now = new Date().toISOString();
  const projects = [];
  const workspaces = [];
  await mkdir(path.join(home, "projects"));
  for (const id of ["many-users", "other-user"]) {
    const cwd = path.join(home, id);
    await mkdir(cwd);
    projects.push({
      projectId: id,
      rootPath: cwd,
      kind: "non_git",
      displayName: id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    const participants =
      id === "many-users" ? actors : [{ kind: "user", id: "other", displayName: "Other user" }];
    workspaces.push({
      workspaceId: id,
      projectId: id,
      cwd,
      kind: "directory",
      displayName: id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      createdBy: participants[0],
      participantActors: participants,
      channels: [
        {
          hubOrigin: "https://filter-fixture.example",
          organizationId: "filter-org",
          connectionId: "filter-slack",
          channelId: id,
          displayName: id,
        },
      ],
    });
  }
  for (const [index, actor] of actors.entries()) {
    if (index === 0) continue;
    const id = `background-${index}`;
    const cwd = path.join(home, "many-users", id);
    await mkdir(cwd);
    workspaces.push({
      workspaceId: id,
      projectId: "many-users",
      cwd,
      kind: "directory",
      displayName: id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      background: true,
      createdBy: actor,
      participantActors: [actor],
      channels: [],
    });
  }
  await writeFile(path.join(home, "projects/projects.json"), JSON.stringify(projects));
  await writeFile(path.join(home, "projects/workspaces.json"), JSON.stringify(workspaces));
}

async function openUserFilter(page: Page): Promise<void> {
  await page.getByTestId("sidebar-display-preferences-menu").filter({ visible: true }).click();
  await page.getByTestId("sidebar-display-user-filter").click();
}

for (const compact of [false, true]) {
  test(`metadata filter supports long lists and search on ${compact ? "compact" : "desktop"}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const home = await createTempDirectory("sidebar-filter-home-");
    await seedDirectory(home.path);
    const host = await startIsolatedHostDaemon("metadata-filter-host", {
      clisbotHome: home.path,
      preserveHome: true,
    });
    try {
      await page.setViewportSize({ width: 1200, height: 800 });
      await openProjectDirectoryWithHosts(page, {
        hosts: [{ serverId: host.serverId, label: "Filter fixture", port: host.port }],
      });
      if (compact) {
        await page.setViewportSize({ width: 390, height: 844 });
        await openMobileAgentSidebar(page);
      }
      const manyRow = page
        .getByTestId(`sidebar-workspace-row-${host.serverId}:many-users`)
        .filter({ visible: true });
      const otherRow = page
        .getByTestId(`sidebar-workspace-row-${host.serverId}:other-user`)
        .filter({ visible: true });
      await expect(manyRow).toBeVisible();
      await expect(otherRow).toBeVisible();
      await openUserFilter(page);
      await expect(page.getByRole("menuitem", { name: /Test user/ })).toHaveCount(78);
      const search = page.getByTestId("sidebar-metadata-filter-search");
      const last = page.getByRole("menuitem", { name: /Văn Đặng/ });
      if (!compact) {
        const surface = page.getByTestId("sidebar-display-preferences-content-userFilter");
        const bounds = await surface.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1200);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
        expect(bounds!.height).toBeLessThanOrEqual(402);
        await surface.hover();
        await page.mouse.wheel(0, 3000);
        await expect(last).toBeInViewport();
        await page.mouse.wheel(0, -3000);
      } else {
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
        await search.scrollIntoViewIfNeeded();
      }
      await page.screenshot({ path: testInfo.outputPath("long-user-filter.png") });
      await expect(search).toBeVisible();
      await search.fill("thanh nga");
      await expect(page.getByRole("menuitem", { name: /Hồ Thị Thanh Nga/ })).toBeVisible();
      await expect(last).toHaveCount(0);
      await page.mouse.move(1150, 10);
      await search.press("Home");
      await expect(search).toBeFocused();
      // Home has platform-specific caret behavior. It must leave the query editable.
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("thanh ngax");
      await expect(search).toHaveValue("thanh ngax");
      await search.fill("thanh nga");
      await search.press("End");
      await expect(search).toBeFocused();
      await page.keyboard.type("x");
      await expect(search).toHaveValue("thanh ngax");
      await search.fill("thanh nga");
      await page.getByRole("menuitem", { name: /Hồ Thị Thanh Nga/ }).click();
      await expect(search).toHaveValue("thanh nga");
      await search.fill("VAN DANG");
      await expect(last).toBeVisible();
      await last.click();
      await expect(last).toHaveAttribute("aria-checked", "true");
      await search.fill("filter-user-79");
      await expect(last).toBeVisible();
      await search.fill("missing-user-xyz");
      await expect(page.getByText("No results found", { exact: true })).toBeVisible();
      await page.getByRole("menuitem", { name: "Clear filter", exact: true }).click();
      await search.fill("thanh nga");
      await page.getByRole("menuitem", { name: /Hồ Thị Thanh Nga/ }).click();
      await expect(page.getByRole("menuitem", { name: /Hồ Thị Thanh Nga/ })).toBeInViewport({
        ratio: 1,
      });
      await page.screenshot({ path: testInfo.outputPath("searched-user-filter.png") });
      if (compact) {
        await page
          .getByRole("button", { name: "Bottom sheet backdrop" })
          .first()
          .click({ position: { x: 10, y: 10 } });
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(manyRow).toBeVisible();
      await expect(otherRow).toHaveCount(0);
      // Preserve the real secondary connection across the harness's per-navigation reset.
      await addConnectedHostsAndReload(page, []);
      if (compact) await openMobileAgentSidebar(page);
      await expect(manyRow).toBeVisible();
      await expect(otherRow).toHaveCount(0);
      await openUserFilter(page);
      await expect(search).toHaveValue("");
      if (!compact) {
        const options = page
          .getByTestId("sidebar-display-preferences-content-userFilter")
          .getByRole("menuitem");
        const first = options.nth(1); // First identity, after Clear filter.
        const clear = page.getByRole("menuitem", { name: "Clear filter", exact: true });
        await search.press("ArrowDown");
        await expect(clear).toBeFocused();
        await page.keyboard.press("End");
        await expect(options.last()).toBeFocused();
        await page.keyboard.press("Home");
        await expect(clear).toBeFocused();
        await page.keyboard.press("ArrowDown");
        await expect(first).toBeFocused();
        await expect(first).toHaveAttribute("aria-checked", "false");
        await page.keyboard.press("Enter");
        await expect(first).toHaveAttribute("aria-checked", "true");
        await page.keyboard.press("Space");
        await expect(first).toHaveAttribute("aria-checked", "false");
      }
      await search.fill("thanh nga");
      await expect(page.getByRole("menuitem", { name: /Hồ Thị Thanh Nga/ })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    } finally {
      await host.close();
      await home.cleanup();
    }
  });
}
