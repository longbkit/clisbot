import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace } from "../support/helpers/seed-client";
import { fillNewWorkspaceDraft, expectNewWorkspaceDraft } from "../support/helpers/new-workspace";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { getServerId } from "../support/helpers/server-id";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker-constants";

async function findQuickStart(client: DaemonClient, name: string) {
  const catalog = await client.listQuickStarts();
  return catalog.items?.find((item) => item.name === name);
}

function scrollTop(element: HTMLElement | SVGElement) {
  return element.scrollTop;
}

test.describe("Home and daemon quick starts", () => {
  test.describe.configure({ timeout: 180000 });
  test("Home scrolls from blank space, expands Recent and offers mobile search without Inbox overlap", async ({
    page,
  }, info) => {
    test.setTimeout(300000);
    const workspace = await seedWorkspace({ repoPrefix: "home-layout-" });
    let secondaryDaemon: Awaited<ReturnType<typeof startIsolatedHostDaemon>> | undefined;
    let secondaryWorkspace: Awaited<ReturnType<typeof seedWorkspace>> | undefined;
    try {
      for (let index = 0; index < 14; index++) {
        await createMockIdleAgent(workspace.client, {
          cwd: workspace.workspaceDirectory,
          workspaceId: workspace.workspaceId,
          title: `Home layout conversation ${index}`,
        });
      }
      await page.setViewportSize({ width: 1440, height: 800 });
      await gotoAppShell(page);
      const activity = page.getByTestId("home-activity");
      const rows = activity.getByRole("button").filter({ hasText: "Home layout conversation" });
      await expect(rows).toHaveCount(10);
      const scroll = page.getByTestId("home-scroll");
      const bounds = (await scroll.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width - 30, bounds.y + 100);
      await page.mouse.wheel(0, 500);
      await expect.poll(() => scroll.evaluate(scrollTop)).toBeGreaterThan(100);
      await activity.getByRole("button", { name: "Show more", exact: true }).click();
      await expect(rows).toHaveCount(14);
      await expect(activity.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);

      secondaryDaemon = await startIsolatedHostDaemon("home-layout-secondary");
      secondaryWorkspace = await seedWorkspace({
        repoPrefix: "home-layout-secondary-",
        port: secondaryDaemon.port,
      });
      await createMockIdleAgent(secondaryWorkspace.client, {
        cwd: secondaryWorkspace.workspaceDirectory,
        workspaceId: secondaryWorkspace.workspaceId,
        title: "Secondary Home layout conversation 13",
      });
      await addConnectedHostAndReload(page, {
        serverId: secondaryDaemon.serverId,
        label: "Secondary Host",
        port: secondaryDaemon.port,
        primaryLabel: "Primary Host",
      });

      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const search = page
          .getByTestId("mobile-toolbar")
          .filter({ visible: true })
          .getByRole("button", { name: "Search", exact: true });
        await expect(search).toBeVisible();
        await search.click();
        await page.getByTestId("command-center-input").fill("Home layout conversation 13");
        await expect(
          page
            .getByTestId(/^command-center-agent-/)
            .filter({ hasText: "Home layout conversation 13" }),
        ).toHaveCount(2);
        await page.keyboard.press("Escape");
        await page
          .getByTestId("home-mobile-tabs")
          .getByRole("tab", { name: /^Inbox, / })
          .click();
        const input = page.getByTestId("sessions-search-input").filter({ visible: true });
        await expect(input).toBeVisible();
        const type = page.getByRole("button", { name: "Type: All types", exact: true });
        await expect(type).toBeVisible();
        const inputBounds = (await input.boundingBox())!;
        const typeBounds = (await type.boundingBox())!;
        expect(inputBounds.height).toBeGreaterThanOrEqual(20);
        expect(typeBounds.y).toBeGreaterThan(inputBounds.y + inputBounds.height);
        const host = page.getByTestId("sessions-host-filter-trigger").filter({ visible: true });
        await expect(host).toBeVisible();
        const hostBounds = (await host.boundingBox())!;
        expect(hostBounds.y).toBeGreaterThan(inputBounds.y + inputBounds.height);
        expect(hostBounds.x + hostBounds.width).toBeLessThanOrEqual(width);
        expect(typeBounds.x + typeBounds.width).toBeLessThanOrEqual(width);
        expect(
          hostBounds.x + hostBounds.width <= typeBounds.x ||
            hostBounds.y + hostBounds.height <= typeBounds.y,
        ).toBe(true);
        const header = page.getByTestId("composer-dock-header").filter({ visible: true });
        const headerBounds = (await header.boundingBox())!;
        expect(inputBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height);
        await input.fill("Home layout conversation 13");
        const matches = page
          .getByTestId(/^agent-row-title-/)
          .filter({ visible: true })
          .filter({ hasText: "Home layout conversation" });
        await expect(matches).toHaveCount(2);
        await host.click();
        await page.getByTestId(`sessions-host-filter-item-${getServerId()}`).click();
        await expect(matches).toHaveCount(1);
        await expect(matches).toHaveText("Home layout conversation 13");
        await host.click();
        await page.getByTestId(`sessions-host-filter-item-${secondaryDaemon.serverId}`).click();
        await expect(matches).toHaveCount(1);
        await expect(matches).toHaveText("Secondary Home layout conversation 13");
        await host.click();
        await page.getByTestId(`sessions-host-filter-item-${ALL_HOSTS_OPTION_ID}`).click();
        await expect(matches).toHaveCount(2);
        await page.screenshot({ path: info.outputPath(`inbox-${width}.png`), fullPage: true });
        await page
          .getByTestId("home-mobile-tabs")
          .getByRole("tab", { name: "Home", exact: true })
          .click();
        await page.screenshot({ path: info.outputPath(`home-${width}.png`), fullPage: true });
      }
    } finally {
      await secondaryWorkspace?.cleanup();
      await secondaryDaemon?.close();
      await workspace.cleanup();
    }
  });
  test("saves, pins, synchronizes and applies a worktree quick start", async ({ page }, info) => {
    const workspace = await seedWorkspace({ repoPrefix: "home-quick-start-" });
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "quick-start-observer",
    });
    let savedId: string | undefined;
    try {
      await gotoAppShell(page);
      await expect(page).toHaveURL(/\/open-project$/);
      await expect(page.getByTestId("workspace-create-submit")).toBeVisible();
      await fillNewWorkspaceDraft(page, "Investigate and fix this bug:");
      await page.getByRole("link", { name: "View all quick starts" }).click();
      await page.getByRole("button", { name: "New quick start", exact: true }).click();
      await page.getByTestId("quick-start-name").fill("Fix a bug safely");
      await page.getByRole("button", { name: "New worktree", exact: true }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      // The library lists it, and Home already shows it pinned.
      await expect(
        page.locator("#overlay-root").getByText("Fix a bug safely", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByTestId("home-scroll").getByText("Fix a bug safely", { exact: true }),
      ).toBeVisible();
      const catalog = await client.listQuickStarts();
      expect(catalog.error).toBeNull();
      const saved = catalog.items!.find((item) => item.name === "Fix a bug safely")!;
      savedId = saved.id;
      expect(saved.target).toMatchObject({
        kind: "project",
        workspace: { kind: "worktree" },
      });
      expect(saved.startingPrompt).toBe("Investigate and fix this bug:");
      // A new quick start is pinned to Home as it is saved, with no separate Pin step.
      await expect
        .poll(async () => (await client.listQuickStarts()).preferences?.pinnedIds)
        .toEqual([savedId]);
      // Another device edits the shared daemon record; the live UI invalidates without reload.
      const changed = await client.saveQuickStart({
        id: saved.id,
        expectedRevision: saved.revision,
        input: { ...saved, name: "Fix bug with tests" },
      });
      expect(changed.error).toBeNull();
      await expect(page.getByText("Fix bug with tests", { exact: true }).last()).toBeVisible();
      await page.getByText("Fix bug with tests", { exact: true }).last().click();
      await expectNewWorkspaceDraft(page, "Investigate and fix this bug:");
      await expect(page.getByTestId("workspace-create-isolation-trigger")).toContainText(
        "New worktree",
      );
      await page.screenshot({
        path: info.outputPath("home-desktop.png"),
        fullPage: true,
      });
      await page.reload();
      await expect(page.getByText("Fix bug with tests", { exact: true }).last()).toBeVisible();
      const createdIds: string[] = [];
      for (let index = 0; index < 2; index++) {
        await page.getByRole("button", { name: "Fix bug with tests", exact: true }).click();
        await expectNewWorkspaceDraft(page, "Investigate and fix this bug:");
        await page.getByTestId("workspace-create-submit").filter({ visible: true }).click();
        await expect(page).toHaveURL(/\/workspace\//, { timeout: 45000 });
        const workspaceUrl = page.url();
        expect(createdIds).not.toContain(workspaceUrl);
        createdIds.push(workspaceUrl);
        await page.getByTestId("sidebar-home").filter({ visible: true }).click();
        await expect(page).toHaveURL(/\/open-project$/);
      }
    } finally {
      if (savedId) {
        const item = (await client.listQuickStarts()).items?.find((entry) => entry.id === savedId);
        if (item)
          await client.deleteQuickStart({
            id: savedId,
            expectedRevision: item.revision,
          });
      }
      await client.close();
      await workspace.cleanup();
    }
  });
  test("mobile starts at Home, opens the existing Chat sidebar and keeps Automations", async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({ repoPrefix: "home-mobile-" });
    try {
      await gotoAppShell(page);
      await expect(page).toHaveURL(/\/open-project$/);
      const tabs = page.getByTestId("home-mobile-tabs");
      await expect(tabs).toBeVisible();
      await page.screenshot({
        path: info.outputPath("home-mobile.png"),
        fullPage: true,
      });
      await tabs.getByRole("tab", { name: "Chat", exact: true }).click();
      await expect(page).toHaveURL(/\/chat$/);
      await expect(page.getByTestId("sidebar-home")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-global-new-workspace")).toBeVisible();
      await tabs.getByRole("tab", { name: /^Inbox, / }).click();
      await expect(page.getByText("Inbox", { exact: true }).first()).toBeVisible();
      await tabs.getByRole("tab", { name: "Automations", exact: true }).click();
      await expect(page).toHaveURL(/\/schedules$/);
      await tabs.getByRole("tab", { name: "Home", exact: true }).click();
      await page.getByRole("link", { name: "View all quick starts" }).click();
      await page.getByRole("button", { name: "New quick start", exact: true }).click();
      await page.getByTestId("quick-start-name").fill("Mobile draft");
      await page
        .getByTestId("quick-start-prompt")
        .fill("Keep this draft while choosing a destination");
      await page.getByTestId("quick-start-destination").click();
      await expect(page.getByText("Where to chat", { exact: true })).toHaveCount(2);
      await page.goBack();
      await expect(page.getByText("Where to chat", { exact: true })).toHaveCount(1);
      await expect(page.getByTestId("quick-start-name")).toHaveValue("Mobile draft");
      await expect(page.getByTestId("quick-start-prompt")).toHaveValue(
        "Keep this draft while choosing a destination",
      );
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
      await page.screenshot({
        path: info.outputPath("quick-start-mobile.png"),
        fullPage: true,
      });
      await page.goBack();
      await expect(
        page.getByRole("button", { name: "New quick start", exact: true }),
      ).toBeVisible();
      await page.goForward();
      await expect(page.getByTestId("quick-start-name")).toHaveValue("Mobile draft");
      await expect(page.getByTestId("quick-start-prompt")).toHaveValue(
        "Keep this draft while choosing a destination",
      );
      await page.goBack();
      await page.getByRole("button", { name: "Continue draft", exact: true }).click();
      await expect(page.getByTestId("quick-start-name")).toHaveValue("Mobile draft");
      await page.goBack();
      await page.goBack();
      await expect(tabs).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Quick starts in Navigation V2", () => {
  test.describe.configure({ timeout: 180000 });
  test.use({ navigationV2: true });

  test("a new quick start is on Home at once, and Send right away starts the chat in one tap", async ({
    page,
  }, info) => {
    const workspace = await seedWorkspace({ repoPrefix: "home-quick-start-send-" });
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "quick-start-send-observer",
    });
    let savedId: string | undefined;
    const prompt = `Summarize today's changes ${Date.now()}`;
    try {
      await gotoAppShell(page);
      await expect(page).toHaveURL(/\/open-project$/);
      await fillNewWorkspaceDraft(page, prompt);
      await page.getByRole("link", { name: "View all quick starts" }).click();
      await page.getByRole("button", { name: "New quick start", exact: true }).click();
      await page.getByTestId("quick-start-name").fill("Daily summary");
      await page.getByText("Send right away", { exact: true }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .poll(() => findQuickStart(client, "Daily summary"))
        .toMatchObject({ autoSend: true, startingPrompt: prompt });
      const saved = (await findQuickStart(client, "Daily summary"))!;
      savedId = saved.id;
      expect((await client.listQuickStarts()).preferences?.pinnedIds?.[0]).toBe(savedId);

      const library = page.locator("#overlay-root").getByRole("button", { name: "Daily summary" });
      await expect(async () => {
        await page.keyboard.press("Escape");
        await expect(library).toHaveCount(0, { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      // Start from an empty composer, so the sent text is the quick start's alone.
      await fillNewWorkspaceDraft(page, "");
      const tile = page.getByTestId("home-scroll").getByRole("button", {
        name: "Daily summary",
        exact: true,
      });
      await expect(tile.getByTestId("quick-start-sends-on-tap")).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: info.outputPath("quick-start-send-tile.png") });
      await tile.click();
      await expect(page).toHaveURL(/\/workspace\//, { timeout: 45_000 });
      await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      if (savedId) {
        const item = (await client.listQuickStarts()).items?.find((entry) => entry.id === savedId);
        if (item) await client.deleteQuickStart({ id: savedId, expectedRevision: item.revision });
      }
      await client.close();
      await workspace.cleanup();
    }
  });
});
