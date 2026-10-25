import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { addOfflineHostAndReload } from "../support/helpers/hosts";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";

// The web part of the Navigation V2 acceptance screenshot matrix
// (docs/features/navigation-v2/README.md#verification): every screen × size × theme × locale.
// Opt in with E2E_NAV_V2_MATRIX_DIR=<folder>; one test per theme × locale.
const DIR = process.env.E2E_NAV_V2_MATRIX_DIR;
const SIZES = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1024", width: 1024, height: 768 },
  { name: "phone-320", width: 320, height: 640 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
] as const;
const COMBOS = [
  { theme: "light", language: "en" },
  { theme: "dark", language: "en" },
  { theme: "light", language: "vi" },
  { theme: "dark", language: "vi" },
] as const;

type Size = (typeof SIZES)[number];

interface Seeded {
  sessionRoute: string;
  failedId: string;
  seenId: string;
  cleanup(): Promise<void>;
}

async function fail(client: DaemonClient, id: string) {
  await client.sendAgentMessage(id, "Emit a synthetic turn failure.");
  await client.waitForAgentUpsert(id, (agent) => agent.status === "error", 30_000);
}

async function seed(): Promise<Seeded> {
  const workspace = await seedWorkspace({ repoPrefix: "nav-v2-matrix-" });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "nav-v2-matrix" });
  const idle = await createMockIdleAgent(workspace.client, {
    cwd: workspace.workspaceDirectory,
    workspaceId: workspace.workspaceId,
    title: "Release notes draft",
  });
  const failed = await createMockIdleAgent(workspace.client, {
    cwd: workspace.workspaceDirectory,
    workspaceId: workspace.workspaceId,
    title: "Fix Android image upload",
  });
  const seen = await createMockIdleAgent(workspace.client, {
    cwd: workspace.workspaceDirectory,
    workspaceId: workspace.workspaceId,
    title: "Nightly import job",
  });
  await fail(client, failed.id);
  await fail(client, seen.id);
  const bots = await Promise.all(
    ["Nia", "Theo"].map((name) =>
      client.createBot({
        name,
        kind: "personal",
        launch: { provider: "mock", model: "ten-second-stream" },
      }),
    ),
  );
  const botIds = bots.map((bot) => bot.bot!.id);
  await client.createChat({ botIds, title: "Launch planning" });
  return {
    sessionRoute: buildHostAgentDetailRoute(getServerId(), idle.id, workspace.workspaceId),
    failedId: failed.id,
    seenId: seen.id,
    async cleanup() {
      for (const bot of bots) {
        await client.archiveBot({ botId: bot.bot!.id });
        await client.removeProject(bot.bot!.projectId);
      }
      await client.close();
      await workspace.cleanup();
    },
  };
}

async function useSettings(page: Page, theme: string, language: string) {
  await page.addInitScript(
    ({ theme: wanted, language: lang }) => {
      localStorage.setItem(
        "@clisbot:app-settings",
        JSON.stringify({ theme: wanted, language: lang }),
      );
    },
    { theme, language },
  );
}

async function settle(page: Page, testID: string) {
  await expect(page.getByTestId(testID).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(700);
}

function issue(id: string, suffix = "") {
  return `issue-actions-${getServerId()}-${id}${suffix}`;
}

/** Each screen: where it is and what proves it has settled. */
async function captureScreens(page: Page, seeded: Seeded, size: Size, folder: string) {
  const shot = (screen: string) =>
    page.screenshot({ path: `${folder}/${screen}-${size.name}.png` });
  await page.setViewportSize({ width: size.width, height: size.height });
  const routes = [
    ["home", "/open-project", "home-controls"],
    ["chats", "/chat", "chats-pane"],
    ["work", "/work", "work-pane"],
    ["more", "/more", "more-screen"],
    ["tasks", "/tasks", "tasks-screen"],
    ["schedules", "/schedules", "schedules-empty"],
  ] as const;
  for (const [screen, route, ready] of routes) {
    await page.goto(route);
    await settle(page, ready);
    await shot(screen);
  }
  await page.goto(seeded.sessionRoute);
  await settle(page, "message-input-root");
  await shot("session-detail");

  await page.goto("/open-project");
  await settle(page, issue(seeded.failedId));
  await page.getByTestId(issue(seeded.failedId)).scrollIntoViewIfNeeded();
  await page.getByTestId(issue(seeded.failedId, "-menu")).click();
  await settle(page, issue(seeded.failedId, "-mark"));
  await shot("failed-row-actions");
  await page.keyboard.press("Escape");

  await page.getByTestId("home-seen-issues").scrollIntoViewIfNeeded();
  await page.getByTestId("home-seen-issues").click();
  await settle(page, `agent-row-${getServerId()}-${seeded.seenId}`);
  await shot("seen-issues");
}

const matrixDescribe = DIR ? test.describe : test.describe.skip;
test.use({ navigationV2: true });

matrixDescribe("Navigation V2 screenshot matrix", () => {
  test.describe.configure({ mode: "serial" });

  for (const combo of COMBOS) {
    test(`${combo.theme} · ${combo.language}`, async ({ page }) => {
      test.setTimeout(900_000);
      const folder = `${DIR}/${combo.theme}-${combo.language}`;
      mkdirSync(folder, { recursive: true });
      const seeded = await seed();
      try {
        await useSettings(page, combo.theme, combo.language);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/open-project");
        // One failure goes to Seen issues once, so every size shows the collapsed row.
        await settle(page, issue(seeded.seenId));
        await page.getByTestId(issue(seeded.seenId, "-menu")).click();
        await page.getByTestId(issue(seeded.seenId, "-mark")).click();
        await expect(page.getByTestId("home-seen-issues")).toBeVisible();
        for (const size of SIZES) await captureScreens(page, seeded, size, folder);

        // Last, because the offline Host stays in the registry: the compact connection notice.
        await addOfflineHostAndReload(page, {
          serverId: "nav-v2-matrix-offline",
          label: "Studio Mini",
          primaryLabel: "This Mac",
        });
        for (const size of SIZES) {
          await page.setViewportSize({ width: size.width, height: size.height });
          await page.goto("/open-project");
          await settle(page, "home-connection-issues");
          await page.screenshot({ path: `${folder}/connection-notice-${size.name}.png` });
        }
      } finally {
        await seeded.cleanup();
      }
    });
  }
});
