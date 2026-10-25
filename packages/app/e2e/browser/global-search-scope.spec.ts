import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test as base } from "../support/fixtures";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { addOfflineHostsAndReload } from "../support/helpers/hosts";
import {
  startIsolatedHostDaemon,
  type IsolatedHostDaemon,
} from "../support/helpers/isolated-host-daemon";
import { openProjectDirectoryWithHosts } from "../support/helpers/project-grouping";
import { connectSeedClient, type SeedDaemonClient } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { createTempGitRepo } from "../support/helpers/workspace";

/**
 * Global search Host / Project scope (docs/features/global-search/README.md) in the real app:
 * this daemon and a second one both carry a project named "clisbot", an offline Host stays
 * listed, and one project lives only on this daemon.
 */

const PRIMARY = "Máy của Long";
const SANDBOX = "sandbox-12";
const OFFLINE = "sandbox-14";
const OFFLINE_ID = "srv_offline_sandbox14";
const SCREENSHOTS = process.env.GS_SCREENSHOTS === "1";
const ARTIFACTS = path.resolve(__dirname, "../../../../artifacts/global-search");

interface Fleet {
  sandbox: { serverId: string; label: string; port: number };
}

async function createProject(
  client: SeedDaemonClient,
  input: { name: string; workspace: string; prefix: string },
): Promise<{ projectId: string; workspaceId: string; path: string; cleanup(): Promise<void> }> {
  const repo = await createTempGitRepo(input.prefix);
  const created = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
    title: input.workspace,
  });
  if (!created.workspace) throw new Error(created.error ?? `Failed to create ${input.name}`);
  await client.renameProject(created.workspace.projectId, input.name);
  return {
    projectId: created.workspace.projectId,
    workspaceId: created.workspace.id,
    path: repo.path,
    cleanup: () => repo.cleanup(),
  };
}

const test = base.extend<{ fleet: Fleet }>({
  fleet: async ({ page: _page }, provide) => {
    const sandbox: IsolatedHostDaemon = await startIsolatedHostDaemon("global-search-sandbox");
    const primary = await connectSeedClient();
    const secondary = await connectSeedClient({ port: sandbox.port });
    const made: { client: SeedDaemonClient; projectId: string; cleanup(): Promise<void> }[] = [];
    try {
      const clisbot = await createProject(primary, {
        name: "clisbot",
        workspace: "release notes",
        prefix: "gs-clisbot-",
      });
      made.push({ client: primary, ...clisbot });
      const anyapp = await createProject(primary, {
        name: "anyapp",
        workspace: "anyapp setup",
        prefix: "gs-anyapp-",
      });
      made.push({ client: primary, ...anyapp });
      const remote = await createProject(secondary, {
        name: "clisbot",
        workspace: "release train",
        prefix: "gs-clisbot-remote-",
      });
      made.push({ client: secondary, ...remote });
      mkdirSync(path.join(clisbot.path, "docs"), { recursive: true });
      await createMockIdleAgent(primary, {
        cwd: clisbot.path,
        workspaceId: clisbot.workspaceId,
        title: "Draft release checklist",
      });
      await provide({
        sandbox: { serverId: sandbox.serverId, label: SANDBOX, port: sandbox.port },
      });
    } finally {
      for (const entry of made) {
        await entry.client.removeProject(entry.projectId).catch(() => undefined);
        await entry.cleanup().catch(() => undefined);
      }
      await primary.close().catch(() => undefined);
      await secondary.close().catch(() => undefined);
      await sandbox.close().catch(() => undefined);
    }
  },
});

async function openFleet(page: Page, fleet: Fleet): Promise<void> {
  await openProjectDirectoryWithHosts(page, { hosts: [fleet.sandbox], primaryLabel: PRIMARY });
  await addOfflineHostsAndReload(page, [{ serverId: OFFLINE_ID, label: OFFLINE }]);
  await expect(page.getByText("release train").filter({ visible: true }).first()).toBeVisible({
    timeout: 60_000,
  });
}

async function openSearch(page: Page): Promise<Locator> {
  // The Search control is the same on desktop (sidebar footer) and phone (top toolbar).
  await page.getByTestId("sidebar-footer-search").filter({ visible: true }).first().click();
  const panel = page.getByTestId("command-center-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

async function type(panel: Locator, text: string): Promise<void> {
  await panel.getByTestId("command-center-input").fill(text);
}

const row = (panel: Locator, testId: string) => panel.getByTestId(testId);
const chip = (panel: Locator, id: string) => panel.getByTestId(`command-center-scope-chip-${id}`);

test.describe("Global search Host and Project scope", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a project on two Hosts is one row; Tab scopes to it on every Host", async ({
    page,
    fleet,
  }) => {
    await openFleet(page, fleet);
    const panel = await openSearch(page);
    await type(panel, "clisbot");
    await expect(row(panel, "command-center-scope-project-clisbot")).toContainText("on 2 Hosts");
    await page.keyboard.press("Tab");
    await expect(chip(panel, "project:clisbot")).toBeVisible();
    await expect(panel.getByTestId("command-center-input")).toHaveValue("");
    await type(panel, "release");
    await expect(panel.getByText("release notes", { exact: true })).toBeVisible();
    await expect(panel.getByText("release train", { exact: true })).toBeVisible();
    await type(panel, "anyapp");
    await expect(panel.getByText("anyapp setup", { exact: true })).toHaveCount(0);
  });

  test("a Host chip with a project it lacks offers the way out", async ({ page, fleet }) => {
    await openFleet(page, fleet);
    const panel = await openSearch(page);
    await type(panel, SANDBOX);
    await expect(row(panel, `command-center-scope-host-${fleet.sandbox.serverId}`)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(chip(panel, `host:${fleet.sandbox.serverId}`)).toBeVisible();
    await type(panel, "anyapp");
    await expect(panel.getByText(`No “anyapp” in ${SANDBOX}`)).toBeVisible();
    await panel.getByTestId("command-center-scope-empty-remove-host").click();
    await expect(chip(panel, `host:${fleet.sandbox.serverId}`)).toHaveCount(0);
    await expect(panel.getByText("anyapp setup", { exact: true })).toBeVisible();
  });

  test("Backspace removes the last chip, and chips return only on a quick reopen", async ({
    page,
    fleet,
  }) => {
    await openFleet(page, fleet);
    let panel = await openSearch(page);
    await type(panel, "clisbot");
    await page.keyboard.press("Tab");
    await type(panel, SANDBOX);
    await page.keyboard.press("Enter");
    await expect(chip(panel, `host:${fleet.sandbox.serverId}`)).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(chip(panel, `host:${fleet.sandbox.serverId}`)).toHaveCount(0);
    await expect(chip(panel, "project:clisbot")).toBeVisible();
    await page.keyboard.press("Escape");
    panel = await openSearch(page);
    await expect(chip(panel, "project:clisbot")).toBeVisible();
  });

  test("the offline Host stays searchable and says so", async ({ page, fleet }) => {
    await openFleet(page, fleet);
    const panel = await openSearch(page);
    await type(panel, OFFLINE);
    // An unreachable Host reads Connecting until the runtime's first attempt stalls (15 s).
    await expect(row(panel, `command-center-scope-host-${OFFLINE_ID}`)).toContainText("Offline", {
      timeout: 30_000,
    });
  });

  test("Show in Work replaces the sidebar Host filter and Undo restores it", async ({
    page,
    fleet,
  }) => {
    await openFleet(page, fleet);
    const panel = await openSearch(page);
    await type(panel, `clisbot ${SANDBOX}`);
    const placement = row(panel, `command-center-scope-project-clisbot-${fleet.sandbox.serverId}`);
    await expect(placement).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByTestId("command-center-panel")).toHaveCount(0);
    await expect.poll(() => storedHostFilters(page)).toEqual([fleet.sandbox.serverId]);
    await page.getByTestId("search-scope-undo").click();
    await expect.poll(() => storedHostFilters(page)).toEqual([]);
  });

  test("a view filter ranks and labels, and offers Only current filter", async ({
    page,
    fleet,
  }) => {
    await openFleet(page, fleet);
    await page.evaluate((serverId) => {
      const raw = JSON.parse(localStorage.getItem("sidebar-view") ?? "{}");
      raw.state = { ...raw.state, hostFilters: [serverId] };
      localStorage.setItem("sidebar-view", JSON.stringify(raw));
      // Keep the Hosts this test added: skip the fixture's registry reset on this reload.
      localStorage.setItem(
        "@clisbot:e2e-disable-default-seed-once",
        localStorage.getItem("@clisbot:e2e-seed-nonce") ?? "",
      );
    }, getServerId());
    await page.reload();
    const panel = await openSearch(page);
    await type(panel, "release");
    await expect(
      panel.getByTestId("command-center-result-note").filter({ hasText: "Outside filter" }).first(),
    ).toBeVisible();
    await panel.getByTestId("command-center-scope-suggestion").click();
    await expect(chip(panel, `host:${getServerId()}`)).toBeVisible();
    await expect(panel.getByText("release train", { exact: true })).toHaveCount(0);
  });

  test("screenshot matrix", async ({ page, fleet }) => {
    test.skip(!SCREENSHOTS, "Set GS_SCREENSHOTS=1 to capture the evidence matrix");
    await openFleet(page, fleet);
    for (const language of ["en", "vi"] as const) {
      await setLanguage(page, language);
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        for (const viewport of [
          { name: "desktop-1440", width: 1440, height: 900 },
          { name: "phone-390", width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport);
          await captureStates(page, fleet, `${viewport.name}-${scheme}-${language}`);
        }
      }
    }
  });
});

async function storedHostFilters(page: Page): Promise<string[]> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("sidebar-view") ?? "{}").state?.hostFilters ?? [],
  );
}

async function setLanguage(page: Page, language: "en" | "vi"): Promise<void> {
  await page.evaluate((value) => {
    const settings = JSON.parse(localStorage.getItem("@clisbot:app-settings") ?? "{}");
    localStorage.setItem("@clisbot:app-settings", JSON.stringify({ ...settings, language: value }));
    localStorage.setItem(
      "@clisbot:e2e-disable-default-seed-once",
      localStorage.getItem("@clisbot:e2e-seed-nonce") ?? "",
    );
  }, language);
  // The sidebar that proves the fleet loaded is only visible on desktop.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByText("release train").filter({ visible: true }).first()).toBeVisible({
    timeout: 60_000,
  });
}

async function shot(page: Page, name: string): Promise<void> {
  // Let the list settle: no row may still be moving in the evidence.
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

async function captureStates(page: Page, fleet: Fleet, suffix: string): Promise<void> {
  let panel = await openSearch(page);
  await type(panel, "clisbot");
  await expect(row(panel, "command-center-scope-project-clisbot")).toBeVisible();
  await shot(page, `01-project-results-${suffix}`);
  await page.keyboard.press("Tab");
  await type(panel, SANDBOX);
  await expect(row(panel, `command-center-scope-host-${fleet.sandbox.serverId}`)).toBeVisible();
  await page.keyboard.press("Enter");
  await shot(page, `02-two-chips-${suffix}`);
  await type(panel, "anyapp");
  await expect(panel.getByTestId("command-center-scope-empty-remove-host")).toBeVisible();
  await shot(page, `03-empty-state-${suffix}`);
  await panel.getByTestId("command-center-scope-empty-everywhere").click();
  await type(panel, OFFLINE);
  await expect(row(panel, `command-center-scope-host-${OFFLINE_ID}`)).toBeVisible();
  await shot(page, `04-offline-host-${suffix}`);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-center-panel")).toHaveCount(0);
  // Past the restore window, so the next state starts without chips.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 10_500)));
  panel = await openSearch(page);
  await expect(chip(panel, "project:clisbot")).toHaveCount(0);
  await page.keyboard.press("Escape");
}
