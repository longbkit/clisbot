import type { Page } from "@playwright/test";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

// Navigation V2 (docs/features/navigation-v2/README.md): rail, Chats/Work, Home feed and More.
const SHOTS = process.env.E2E_NAV_V2_SCREENSHOTS_DIR;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function seedNavigationFixtures() {
  const workspace = await seedWorkspace({ repoPrefix: "nav-v2-" });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "nav-v2" });
  await createMockIdleAgent(workspace.client, {
    cwd: workspace.workspaceDirectory,
    workspaceId: workspace.workspaceId,
    title: "Release notes draft",
  });
  const failing = await createMockIdleAgent(workspace.client, {
    cwd: workspace.workspaceDirectory,
    workspaceId: workspace.workspaceId,
    title: "Fix Android image upload",
  });
  await client.sendAgentMessage(failing.id, "Emit a synthetic turn failure.");
  await client.waitForAgentUpsert(failing.id, (agent) => agent.status === "error", 30_000);
  const bot = await client.createBot({
    name: "Nia",
    kind: "personal",
    launch: { provider: "mock", model: "ten-second-stream" },
  });
  expect(bot.error).toBeNull();
  return {
    workspace,
    client,
    failing,
    botId: bot.bot!.id,
    async cleanup() {
      await client.archiveBot({ botId: bot.bot!.id });
      await client.removeProject(bot.bot!.projectId);
      await client.close();
      await workspace.cleanup();
    },
  };
}

test.describe("Navigation V2", () => {
  test("desktop rail, Home feed lifecycle, Chats, Work, Tasks and /sessions", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const seeded = await seedNavigationFixtures();
    try {
      await gotoAppShell(page);
      const rail = page.getByTestId("navigation-rail");
      await expect(rail).toBeVisible();
      for (const id of ["home", "chats", "work", "schedules", "tasks", "settings"])
        await expect(page.getByTestId(`navigation-rail-${id}`)).toBeVisible();
      await expect(page.getByTestId("sidebar-hosts-trigger")).toBeVisible();
      await expect(page.getByTestId("sidebar-help")).toBeVisible();
      await expect(page.getByTestId("sidebar-unified-pinned")).toHaveCount(0);

      const failedRow = page.getByTestId(`agent-row-${getServerId()}-${seeded.failing.id}`);
      await expect(page.getByTestId("home-feed-controls")).toBeVisible();
      await expect(failedRow).toBeVisible({ timeout: 30_000 });
      const actions = page.getByTestId(`issue-actions-${getServerId()}-${seeded.failing.id}`);
      await expect(actions.getByTestId(/-dismiss$/)).toBeVisible();
      await shot(page, "desktop-home");
      await shot(page, "desktop-failed-row-actions");

      // Mark as seen: it leaves Needs me for the collapsed Seen issues row.
      await page.getByTestId(`issue-actions-${getServerId()}-${seeded.failing.id}-menu`).click();
      await page.getByTestId(`issue-actions-${getServerId()}-${seeded.failing.id}-mark`).click();
      await expect(page.getByTestId("home-seen-issues")).toContainText("(1)");
      await expect(failedRow).toHaveCount(0);
      await shot(page, "desktop-home-seen-issues");
      await page.getByTestId("home-seen-issues").click();
      await expect(failedRow).toBeVisible();

      await page.getByTestId("navigation-rail-chats").click();
      await expect(page).toHaveURL(/\/chat$/);
      await expect(page.getByTestId("chats-pane")).toBeVisible();
      await expect(page.getByTestId(`sidebar-bot-${seeded.botId}`)).toBeVisible({
        timeout: 20_000,
      });
      await shot(page, "desktop-chats");

      await page.getByTestId("navigation-rail-work").click();
      await expect(page).toHaveURL(/\/work$/);
      await expect(page.getByTestId("work-pane")).toBeVisible();
      await shot(page, "desktop-work");

      await page.getByTestId("navigation-rail-tasks").click();
      await expect(page.getByTestId("tasks-screen")).toBeVisible();

      await page.goto("/sessions");
      await expect(page).toHaveURL(/\/open-project$/);
    } finally {
      await seeded.cleanup();
    }
  });

  test("phone tabs, Chats, Work, More and a conversation's Back", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const seeded = await seedNavigationFixtures();
    try {
      await gotoAppShell(page);
      for (const tab of ["open-project", "chat", "work", "schedules", "more"])
        await expect(page.getByTestId(`home-tab-${tab}`)).toBeVisible();
      await expect(page.getByTestId("navigation-rail")).toHaveCount(0);
      await expect(page.getByTestId("home-tab-badge")).toBeVisible({ timeout: 30_000 });
      await shot(page, "mobile-home");

      await page.getByTestId("home-tab-chat").click();
      await expect(page.getByTestId("chats-pane")).toBeVisible();
      await shot(page, "mobile-chats");

      await page.getByTestId("home-tab-work").click();
      await expect(page.getByTestId("work-pane")).toBeVisible();
      await shot(page, "mobile-work");

      await page.getByTestId("home-tab-more").click();
      await expect(page.getByTestId("more-screen")).toBeVisible();
      for (const id of ["tasks", "hosts", "settings"])
        await expect(page.getByTestId(`more-${id}`)).toBeVisible();
      await shot(page, "mobile-more");
    } finally {
      await seeded.cleanup();
    }
  });
});
