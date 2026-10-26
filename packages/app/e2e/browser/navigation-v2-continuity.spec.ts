import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { composerLocator, expectComposerDraft } from "../support/helpers/composer";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { buildAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

/**
 * Navigation V2 acceptance S2, S5 and S7 (Round 2 checklist D2): the reader's place survives a
 * Host dropping and coming back; deep links, /sessions and Back land where they say; preferences
 * stored before this round migrate, and the flag off restores the old layout.
 */

/** Preferences as main (v0) stored them: the Display menu's Bot projects switch, no Bots chip. */
const MAIN_NAVIGATION_PREFERENCES = JSON.stringify({
  state: {
    homeMode: "work",
    scopes: { home: "mine", chats: "mine", work: "others" },
    lastList: "work",
    showBotProjectsInWork: false,
    chatsSort: "name",
    chatsSplit: true,
    chatsHosts: [],
  },
  version: 0,
});
const MAIN_BOT_PROJECTS = JSON.stringify({ state: { showBotProjects: false }, version: 1 });

async function seedStoredPreferences(page: Page) {
  await page.addInitScript(
    ({ navigation, botProjects }) => {
      if (localStorage.getItem("@clisbot:e2e-continuity-seeded")) return;
      localStorage.setItem("@clisbot:e2e-continuity-seeded", "1");
      localStorage.setItem("clisbot-navigation-preferences", navigation);
      localStorage.setItem("sidebar-bot-projects", botProjects);
    },
    { navigation: MAIN_NAVIGATION_PREFERENCES, botProjects: MAIN_BOT_PROJECTS },
  );
}

function storedJson(page: Page, key: string) {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? "null"), key);
}

test.describe("Navigation V2 continuity", () => {
  test.use({ navigationV2: true });

  test("S2: a session keeps its route and draft while its Host drops and returns", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const serverId = `srv_continuity_${randomUUID().slice(0, 8)}`;
    const daemon = await startIsolatedHostDaemon(serverId);
    const workspace = await seedWorkspace({ repoPrefix: "nav-v2-continuity-", port: daemon.port });
    try {
      await createMockIdleAgent(workspace.client, {
        cwd: workspace.workspaceDirectory,
        workspaceId: workspace.workspaceId,
        title: "Continuity session",
      });
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, { serverId, label: "Drop Host", port: daemon.port });
      // A reload re-seeds the Host list, so the session opens from Home rather than by URL.
      await page
        .getByTestId("home-activity")
        .getByText("Continuity session", { exact: true })
        .click({ timeout: 30_000 });
      await expect(composerLocator(page)).toBeEditable({ timeout: 60_000 });
      expect(new URL(page.url()).pathname).toContain(`/h/${serverId}/workspace/`);
      await composerLocator(page).fill("Draft that must survive");
      const route = new URL(page.url()).pathname;

      await daemon.restart();
      // Through the drop and the reconnect: same route, same draft, no jump to Home or a list.
      await page.waitForTimeout(3_000);
      expect(new URL(page.url()).pathname).toBe(route);
      await expectComposerDraft(page, "Draft that must survive");
      await expect(composerLocator(page)).toBeEditable({ timeout: 60_000 });
      expect(new URL(page.url()).pathname).toBe(route);
      await expectComposerDraft(page, "Draft that must survive");
    } finally {
      await workspace.cleanup().catch(() => undefined);
      await daemon.close().catch(() => undefined);
    }
  });

  test("S5: deep links, /sessions and Back land where they say", async ({ page }) => {
    test.setTimeout(180_000);
    const workspace = await seedWorkspace({ repoPrefix: "nav-v2-deeplinks-" });
    try {
      const agent = await createMockIdleAgent(workspace.client, {
        cwd: workspace.workspaceDirectory,
        workspaceId: workspace.workspaceId,
        title: "Deep link session",
      });
      await page.goto("/work");
      await expect(page.getByTestId("work-pane").filter({ visible: true })).toBeVisible({
        timeout: 60_000,
      });
      await page.goto("/chat");
      await expect(page.getByTestId("chats-pane").filter({ visible: true })).toBeVisible();
      await page.goto("/sessions");
      await expect(page).toHaveURL(/\/open-project$/);
      await page.goto(buildAgentRoute(workspace.workspaceId, agent.id, getServerId()));
      await expect(composerLocator(page)).toBeVisible({ timeout: 60_000 });
      await page.goto("/more");
      await expect(page.getByTestId("more-screen")).toBeVisible();
      await page.goBack();
      await expect(composerLocator(page)).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/\/workspace\//);
    } finally {
      await workspace.cleanup();
    }
  });

  test("S7: preferences stored before this round migrate without loss", async ({ page }) => {
    test.setTimeout(120_000);
    await seedStoredPreferences(page);
    await page.goto("/work");
    const work = page.getByTestId("work-pane").filter({ visible: true });
    await expect(work).toBeVisible({ timeout: 60_000 });
    // The Workspace scope the reader chose survives; the Bots chip starts on (its action hides).
    await expect(work.getByTestId("work-scope-others")).toHaveAttribute("aria-selected", "true");
    await expect(work.getByTestId("work-bots-chip")).toHaveAccessibleName("Hide Bot sessions");
    await expect
      .poll(async () => (await storedJson(page, "clisbot-navigation-preferences"))?.version)
      .toBe(3);
    const stored = await storedJson(page, "clisbot-navigation-preferences");
    // Home opens on All (v2); the Workspace scope the reader chose stays.
    expect(stored.state.scopes).toMatchObject({ home: "all", work: "others" });
    expect(stored.state).toMatchObject({
      homeMode: "work",
      chatsSort: "name",
      chatsSplit: true,
      workShowBots: true,
    });
    expect(stored.state).not.toHaveProperty("showBotProjectsInWork");
    // Chats' own Host filter gave way to the app-wide one (v3).
    expect(stored.state).not.toHaveProperty("chatsHosts");
    // The old layout's own switch is untouched, ready for the flag to go off.
    expect((await storedJson(page, "sidebar-bot-projects")).state.showBotProjects).toBe(false);
  });
});

test.describe("Navigation V2 flag off", () => {
  test.use({ navigationV2: false });

  test("S7: the flag off restores the old layout over V2's stored preferences", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await seedStoredPreferences(page);
    await page.goto("/");
    await expect(page.getByTestId("navigation-rail")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-home").filter({ visible: true }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("work-bots-chip")).toHaveCount(0);
  });
});
