import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { UsageReportEntry } from "@clisbot/protocol/messages";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { connectSeedClient, seedWorkspace } from "../support/helpers/seed-client";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { createTempDirectory } from "../support/helpers/workspace";
import { getServerId } from "../support/helpers/server-id";
import { buildAgentRoute } from "../support/helpers/mock-agent";
import { installUsageReportsFixture } from "../support/helpers/usage-reports";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

// Navigation V2 (docs/features/navigation-v2/README.md): rail, Chats/Work, Home feed and More.
const SHOTS = process.env.E2E_NAV_V2_SCREENSHOTS_DIR;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Tags the visible node; a remount replaces it with an untagged one. */
async function markRetained(page: Page, testId: string) {
  await page
    .locator(`[data-testid="${testId}"]:visible`)
    .evaluate((node) => node.setAttribute("data-retained", "1"));
}

function retained(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"][data-retained="1"]`);
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

      // Visited tabs stay mounted: switching back shows the same nodes, not rebuilt ones.
      await markRetained(page, "more-screen");
      await page.getByTestId("home-tab-chat").click();
      await markRetained(page, "chats-pane");
      await page.getByTestId("home-tab-work").click();
      await page.getByTestId("home-tab-more").click();
      await expect(retained(page, "more-screen")).toBeVisible();
      await page.getByTestId("home-tab-chat").click();
      await expect(retained(page, "chats-pane")).toBeVisible();
      await expect(retained(page, "more-screen")).toBeHidden();
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
      await markRetained(page, "work-pane");
      await row.click();
      await expect(page).toHaveURL(/\/workspace\//);
      await expect(page.getByTestId("home-mobile-tabs")).toBeHidden();
      await shot(page, "mobile-session-detail");
      await page.getByTestId("chat-back").click();
      await expect(page).toHaveURL(/\/work$/);
      // Back pops the detail off the retained tabs: the same Work list, not a rebuilt one.
      await expect(retained(page, "work-pane")).toBeVisible();

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

/** How many lines the pin tags take, and how many tags (the fold tag included) they show. */
function tagLines(tags: import("@playwright/test").Locator) {
  return tags.evaluate((root) => {
    const tops = [...root.children].map((child) => Math.round(child.getBoundingClientRect().top));
    return { lines: new Set(tops).size, count: root.children.length };
  });
}

test.describe("Navigation V2 Home pin tags", () => {
  test.use({ navigationV2: true });

  for (const width of [1440, 390]) {
    test(`pins wrap onto two lines and open the rest downward at ${width}px`, async ({ page }) => {
      test.setTimeout(240_000);
      const serverId = `srv_nav_pins_${randomUUID().slice(0, 8)}`;
      const daemon = await startIsolatedHostDaemon(serverId);
      const client = await connectSeedClient({ port: daemon.port });
      const folders = await createTempDirectory("nav-v2-pins-");
      try {
        for (let i = 1; i <= 12; i += 1) {
          const dir = path.join(folders.path, `pinned-${i}`);
          await mkdir(dir, { recursive: true });
          const created = await client.createWorkspace({
            source: { kind: "directory", path: dir },
            title: `Pinned workspace ${String(i).padStart(2, "0")}`,
          });
          if (!created.workspace) throw new Error(created.error ?? "workspace");
          await client.setWorkspacePinned(created.workspace.id, true);
        }
        await page.setViewportSize({ width, height: 900 });
        await gotoAppShell(page);
        await addConnectedHostAndReload(page, { serverId, label: "Pins Host", port: daemon.port });
        const tags = page.getByTestId("home-pin-tags").filter({ visible: true });
        const more = tags.getByTestId("home-pin-tags-more");
        await expect(more).toBeVisible({ timeout: 60_000 });
        const lines = () => tagLines(tags);
        const collapsed = await lines();
        expect(collapsed.lines).toBe(2);
        await expect(more).toContainText(`+${12 - (collapsed.count - 1)}`);
        await more.click();
        const expanded = await lines();
        expect(expanded.lines).toBeGreaterThan(2);
        // Every pin plus the fold tag; nothing scrolls sideways.
        expect(expanded.count).toBeGreaterThanOrEqual(13);
        expect(await tags.evaluate((root) => root.scrollWidth <= root.clientWidth + 1)).toBe(true);
        await tags.getByTestId("home-pin-tags-less").click();
        expect((await lines()).lines).toBe(2);
      } finally {
        await client.close().catch(() => undefined);
        await daemon.close().catch(() => undefined);
        await folders.cleanup().catch(() => undefined);
      }
    });
  }
});

/** One account report for every agent: a 5-hour window resetting in 70 min, a weekly in 26 h. */
function sessionQuotaReports(hourUsedPct = 31): UsageReportEntry[] {
  const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  return [
    {
      id: "codex:me",
      account: { label: "me@example.com" },
      fetchedAt: new Date().toISOString(),
      sourceId: "codex",
      sourceLabel: "Codex",
      report: {
        status: "available",
        windows: [
          { id: "five_hour", label: "Session", usedPct: hourUsedPct, resetsAt: inMinutes(70) },
          { id: "weekly", label: "Weekly", usedPct: 54, resetsAt: inMinutes(26 * 60) },
        ],
      },
    },
  ];
}

test.describe("Navigation V2 session quota", () => {
  test.use({ navigationV2: true });

  test("the rail shows the open session's quota; a phone's More shows the last one opened", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await installUsageReportsFixture(page, { lists: [() => sessionQuotaReports()] });
    const workspace = await seedWorkspace({ repoPrefix: "nav-v2-quota-" });
    try {
      const agent = await createMockIdleAgent(workspace.client, {
        cwd: workspace.workspaceDirectory,
        workspaceId: workspace.workspaceId,
        title: "Quota session",
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoAppShell(page);
      const rail = page.getByTestId("navigation-rail-usage");
      // Home has no session open: the rail shows Usage alone.
      await expect(rail).toBeVisible({ timeout: 60_000 });
      await expect(rail.getByTestId("session-quota")).toHaveCount(0);
      await page.goto(buildAgentRoute(workspace.workspaceId, agent.id));
      await expect(rail.getByTestId("session-quota-hour")).toHaveText("31% 1h", {
        timeout: 60_000,
      });
      await expect(rail.getByTestId("session-quota-week")).toHaveText("54% 1d");
      await shot(page, "session-quota-rail");

      // A phone reaches More from its tabs, or after the app restarts: the last session stays.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/more");
      const usage = page.getByTestId("more-usage").filter({ visible: true });
      await expect(usage.getByTestId("session-quota-hour")).toHaveText("31% 1h", {
        timeout: 30_000,
      });
      await expect(usage.getByTestId("session-quota-week")).toHaveText("54% 1d");
      await shot(page, "session-quota-more");
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Navigation V2 session quota refresh", () => {
  test.use({ navigationV2: true });

  test("the rail's quota follows the daemon on its own, and says when it could not refresh", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    let hourUsedPct = 31;
    let failing = false;
    const usage = await installUsageReportsFixture(page, {
      lists: [() => (failing ? { error: "usage unavailable" } : sessionQuotaReports(hourUsedPct))],
    });
    await page.clock.install({ time: Date.now() });
    const workspace = await seedWorkspace({ repoPrefix: "nav-v2-quota-refresh-" });
    try {
      const agent = await createMockIdleAgent(workspace.client, {
        cwd: workspace.workspaceDirectory,
        workspaceId: workspace.workspaceId,
        title: "Quota refresh session",
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(buildAgentRoute(workspace.workspaceId, agent.id));
      const hour = page.getByTestId("navigation-rail-usage").getByTestId("session-quota-hour");
      await expect(hour).toHaveText("31% 1h", { timeout: 60_000 });

      // No session switch: the next poll brings the new number.
      hourUsedPct = 36;
      await page.clock.fastForward("02:05");
      await expect(hour).toHaveText("36% 1h");
      expect(usage.listRequests().some((request) => request.forceRefresh)).toBe(false);

      // Reads fail: the number stays, and is marked once it is older than a cache lifetime.
      failing = true;
      await page.clock.fastForward("02:05");
      await expect(hour).toHaveText("36% 1h");
      await page.clock.fastForward("06:00");
      // The reset keeps counting down on the faked clock; only the percent is under test.
      await expect(hour).toHaveText(/^~36% /);
      await shot(page, "session-quota-rail-stale");

      failing = false;
      hourUsedPct = 40;
      await page.clock.fastForward("11:00");
      await expect(hour).toHaveText(/^40% /);
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Navigation V2 app-wide Host filter", () => {
  test.use({ navigationV2: true });

  test("one Host filter for Home, Chats and Workspace, shown and cleared on the rail", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const serverId = `srv_nav_hosts_${randomUUID().slice(0, 8)}`;
    const daemon = await startIsolatedHostDaemon(serverId);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, { serverId, label: "Second Host", port: daemon.port });
      const chip = page.getByTestId("home-host-filter").filter({ visible: true });
      await expect(chip).toContainText("All Hosts", { timeout: 60_000 });
      await expect(page.getByTestId("rail-host-count")).toHaveText("2", {
        timeout: 60_000,
      });
      // Choosing a Host on Home filters every list and puts its tag on the rail.
      await chip.click();
      await page.getByText("Second Host", { exact: true }).last().click();
      await page.keyboard.press("Escape");
      await expect(chip).toContainText("Second Host");
      const tag = page.getByTestId("rail-host-filter-tag");
      await expect(tag).toContainText("Second Host");
      await shot(page, "host-filter-home");
      await page.getByTestId("navigation-rail-chats").click();
      await expect(page.getByTestId("chats-display").filter({ visible: true })).toBeVisible();
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem("sidebar-view") ?? "{}").state),
      ).toMatchObject({ hostFilters: [serverId] });
      // ✕ on the rail clears it everywhere.
      await tag.click();
      await expect(tag).toHaveCount(0);
      await page.getByTestId("navigation-rail-home").click();
      await expect(chip).toContainText("All Hosts");
    } finally {
      await daemon.close().catch(() => undefined);
    }
  });
});
