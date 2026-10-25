import type { Page } from "@playwright/test";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

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

test.use({ navigationV2: true });

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
      // Healthy Hosts say nothing on Home; there is no floating updates bar.
      await expect(page.getByTestId("home-hosts")).toHaveCount(0);
      await expect(page.getByTestId("home-connection-issues")).toHaveCount(0);
      await expect(page.getByTestId("home-activity-updates")).toHaveCount(0);

      const failedRow = page.getByTestId(`agent-row-${getServerId()}-${seeded.failing.id}`);
      await expect(page.getByTestId("home-controls")).toBeVisible();
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
      // One Display menu for the mixed list; the old per-group menus are gone.
      await expect(page.getByTestId("sidebar-bots-display-menu")).toHaveCount(0);
      await page.getByTestId("chats-display").click();
      await expect(page.getByTestId("chats-display-split")).toBeVisible();
      await shot(page, "desktop-chats-display");
      await page.keyboard.press("Escape");
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

  test("desktop deep link, list pane toggle, Work +, command center and Settings", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const seeded = await seedNavigationFixtures();
    try {
      await gotoAppShell(page);
      await page.goto(buildHostWorkspaceRoute(getServerId(), seeded.workspace.workspaceId));
      const workPane = page.getByTestId("work-pane");
      await expect(workPane).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("navigation-rail-work")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await shot(page, "desktop-work-session");
      // Pressing the active list section hides its pane and shows it again (as ⌘B does).
      await page.getByTestId("navigation-rail-work").click();
      await expect(workPane).toBeHidden();
      await page.getByTestId("navigation-rail-work").click();
      await expect(workPane).toBeVisible();

      await page.getByTestId("work-new").click();
      for (const id of ["work-new-workspace", "work-new-project", "work-import-session"])
        await expect(page.getByTestId(id)).toBeVisible();
      await page.getByTestId("work-new-workspace").click();
      await expect(page).toHaveURL(/\/new(?:\?.*)?$/);

      await page.getByTestId("work-search").click();
      await expect(page.getByTestId("command-center-panel")).toBeVisible({ timeout: 30_000 });
      await page.keyboard.press("Escape");

      await page.getByTestId("navigation-rail-chats").click();
      await page.getByTestId("chats-new").click();
      await expect(page.getByTestId("chats-new-bot")).toBeVisible();
      await expect(page.getByTestId("chats-new-group")).toBeVisible();
      await page.keyboard.press("Escape");

      await page.getByTestId("navigation-rail-settings").click();
      await expect(page).toHaveURL(/\/settings/);
    } finally {
      await seeded.cleanup();
    }
  });

  test("Home lifecycle: Mark unread, Dismiss, mode and scope filters", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const seeded = await seedNavigationFixtures();
    try {
      await gotoAppShell(page);
      const id = `${getServerId()}-${seeded.failing.id}`;
      const failedRow = page.getByTestId(`agent-row-${id}`);
      await expect(failedRow).toBeVisible({ timeout: 30_000 });
      const badge = page.getByTestId("navigation-rail-home");
      await expect(badge).toContainText("1");

      // Chat mode shows Bot sessions only; the failed work session leaves the feed.
      await page.getByTestId("home-mode-chat").click();
      await expect(failedRow).toHaveCount(0);
      await page.getByTestId("home-mode-hybrid").click();
      await expect(failedRow).toBeVisible();
      // Nobody else owns anything here: Others is empty.
      await page.getByTestId("home-scope-others").click();
      await expect(failedRow).toHaveCount(0);
      await page.getByTestId("home-scope-mine").click();
      await expect(failedRow).toBeVisible();

      await page.getByTestId(`issue-actions-${id}-menu`).click();
      await page.getByTestId(`issue-actions-${id}-mark`).click();
      await expect(page.getByTestId("home-seen-issues")).toBeVisible();
      await expect(badge).not.toContainText("1");
      await page.getByTestId("home-seen-issues").click();
      await shot(page, "desktop-seen-issues-open");
      await page.getByTestId(`issue-actions-${id}-menu`).click();
      await page.getByTestId(`issue-actions-${id}-mark`).click();
      await expect(page.getByTestId("home-seen-issues")).toHaveCount(0);
      await expect(badge).toContainText("1");

      // Dismiss: it leaves Needs me and the badge; the session stays in the feed as history.
      await page.getByTestId(`issue-actions-${id}-dismiss`).click();
      const needs = page.getByTestId("home-activity-section-needs");
      await expect(needs.getByTestId(`agent-row-${id}`)).toHaveCount(0);
      await expect(page.getByTestId(`issue-actions-${id}`)).toHaveCount(0);
      await expect(failedRow).toBeVisible();
      await expect(badge).not.toContainText("1");
    } finally {
      await seeded.cleanup();
    }
  });

  test("phone: a session opened from Work goes Back to Work; dark and Vietnamese", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const seeded = await seedNavigationFixtures();
    try {
      await gotoAppShell(page);
      await expect(page.getByTestId("home-tab-work")).toBeVisible();
      await page.getByTestId("home-tab-work").click();
      const row = page.getByTestId(
        `sidebar-workspace-row-${getServerId()}:${seeded.workspace.workspaceId}`,
      );
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      await expect(page).toHaveURL(/\/workspace\//);
      await expect(page.getByTestId("home-mobile-tabs")).toHaveCount(0);
      await shot(page, "mobile-session-detail");
      await page.getByTestId("chat-back").click();
      await expect(page).toHaveURL(/\/work$/);
      await expect(page.getByTestId("work-pane")).toBeVisible();

      await page.emulateMedia({ colorScheme: "dark" });
      await page.getByTestId("home-tab-open-project").click();
      await expect(page.getByTestId("home-controls")).toBeVisible();
      await shot(page, "mobile-home-dark");
      await page.emulateMedia({ colorScheme: "light" });

      await page.getByTestId("home-tab-more").click();
      await expect(page.getByTestId("more-settings")).toBeVisible();
      // Settings' General page owns the language; set it there, then come back through history.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByTestId("navigation-rail-settings").click();
      await page.getByTestId("language-quick-vi").click();
      await page.goBack();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByTestId("home-tab-more").click();
      await expect(page.getByTestId("more-screen")).toBeVisible();
      await expect(page.getByTestId("home-tab-schedules")).toContainText("Lịch");
      await shot(page, "mobile-more-vi");
      await page.getByTestId("home-tab-chat").click();
      await shot(page, "mobile-chats-vi");
      await page.getByTestId("home-tab-open-project").click();
      await shot(page, "mobile-home-vi");
    } finally {
      await seeded.cleanup();
    }
  });

  for (const width of [320, 430]) {
    test(`phone at ${width}px: every tab and its section header fit`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 800 });
      const seeded = await seedNavigationFixtures();
      try {
        await gotoAppShell(page);
        const tabs: [string, string][] = [
          ["open-project", "home-header"],
          ["chat", "chats-pane"],
          ["work", "work-pane"],
          ["more", "more-screen"],
        ];
        for (const [tab, surface] of tabs) {
          await page.getByTestId(`home-tab-${tab}`).click();
          await expect(page.getByTestId(surface)).toBeVisible();
          if (tab === "open-project")
            // Every start fits: the third segment is on screen, not clipped.
            await expect(page.getByTestId("start-switcher-bot")).toBeInViewport({ ratio: 1 });
          // Nothing pushes the page wider than the phone.
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(overflow).toBeLessThanOrEqual(0);
          await shot(page, `mobile-${width}-${tab}`);
        }
      } finally {
        await seeded.cleanup();
      }
    });
  }
});
