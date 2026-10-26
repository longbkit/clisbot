import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, metroTest as test } from "../support/fixtures";
import { hideDeveloperToasts } from "../support/developer-ui.mjs";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { buildCreateAgentPreferences, buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace } from "../support/helpers/seed-client";

// Navigation V2 acceptance V5: each list's designed states — loading skeleton, offline, empty and
// filtered-empty — on Home, Chats and Work at 1440 and 390, light. Opt in with
// E2E_NAV_V2_STATES_DIR=<folder>.
const DIR = process.env.E2E_NAV_V2_STATES_DIR;
const SIZES = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
] as const;

async function openWithHosts(page: Page, hosts: ReturnType<typeof buildSeededHost>[]) {
  await page.route(/:(6767|6768|6868|6869)\b/, (route) => route.abort());
  await page.routeWebSocket(/:(6767|6768|6868|6869)\b/, async (socket) => {
    await socket.close({ code: 1008, reason: "Blocked developer daemon during e2e." });
  });
  await hideDeveloperToasts(page);
  await page.addInitScript(
    ({ registry, preferences }) => {
      localStorage.setItem("@clisbot:e2e", "1");
      localStorage.setItem("@clisbot:navigation-v2", "1");
      localStorage.setItem("@clisbot:daemon-registry", JSON.stringify(registry));
      localStorage.setItem("@clisbot:create-agent-preferences", JSON.stringify(preferences));
      localStorage.setItem("@clisbot:app-settings", JSON.stringify({ theme: "light" }));
    },
    { registry: hosts, preferences: buildCreateAgentPreferences() },
  );
}

function host(serverId: string, port: number) {
  return buildSeededHost({
    serverId,
    endpoint: `127.0.0.1:${port}`,
    nowIso: new Date().toISOString(),
  });
}

/** Each list in turn: Home is a page, Chats and Work are list panes (a tab on phones). */
async function shoot(page: Page, state: string, folder: string, ready: Record<string, string>) {
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const [screen, route] of [
      ["home", "/open-project"],
      ["chats", "/chat"],
      ["work", "/work"],
    ] as const) {
      await page.goto(route);
      const wanted = ready[screen];
      if (wanted) await expect(page.getByTestId(wanted).first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${folder}/${screen}-${state}-${size.name}.png` });
    }
  }
}

const statesDescribe = DIR ? test.describe : test.describe.skip;

statesDescribe("Navigation V2 list states", () => {
  test.describe.configure({ mode: "serial" });

  test("loading and offline with an unreachable Host", async ({ page }) => {
    test.setTimeout(600_000);
    const folder = `${DIR}`;
    mkdirSync(folder, { recursive: true });
    // A closed port: the Host stays "connecting", so the lists show their loading state first.
    const unreachable = host(`srv_nav_states_${randomUUID().slice(0, 8)}`, 9);
    await openWithHosts(page, [unreachable]);
    await shoot(page, "loading", folder, {
      home: "home-activity-placeholder",
      chats: "chats-pane",
      work: "work-pane",
    });
    // The runtime calls the Host unreachable after ~15s of retries; a page load restarts that
    // clock, so stay on one load and switch sections in-app.
    for (const size of SIZES) {
      const phone = size.width < 500;
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/open-project");
      await expect(page.getByTestId("home-feed-offline")).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${folder}/home-offline-${size.name}.png` });
      for (const [screen, press] of [
        ["chats", phone ? "home-tab-chat" : "navigation-rail-chats"],
        ["work", phone ? "home-tab-work" : "navigation-rail-work"],
      ] as const) {
        await page.getByTestId(press).click();
        await expect(page.getByTestId(`${screen}-offline`).first()).toBeVisible();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${folder}/${screen}-offline-${size.name}.png` });
      }
    }
  });

  test("empty and filtered-empty on a fresh Host", async ({ page }) => {
    test.setTimeout(600_000);
    const folder = `${DIR}`;
    const serverId = `srv_nav_states_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const daemon = await startIsolatedHostDaemon(serverId);
    try {
      await openWithHosts(page, [host(serverId, daemon.port)]);
      await shoot(page, "empty", folder, {
        home: "home-feed-empty",
        chats: "chats-list-empty",
        work: "work-pane",
      });

      const workspace = await seedWorkspace({ repoPrefix: "nav-v2-states-", port: daemon.port });
      const client = await connectDaemonClient<DaemonClient>({
        clientIdPrefix: "nav-v2-states",
        port: daemon.port,
      });
      try {
        await client.createAgent({
          provider: "mock",
          cwd: workspace.repoPath,
          workspaceId: workspace.workspaceId,
          title: "Release notes draft",
          modeId: "load-test",
          model: "e2e-fast-stream",
        });
        await client.createBot({
          name: "Nia",
          kind: "personal",
          launch: { provider: "mock", model: "e2e-fast-stream" },
        });
        for (const size of SIZES) {
          await page.setViewportSize({ width: size.width, height: size.height });
          await page.goto("/chat");
          await page.getByTestId("chats-chip-unread").click();
          await expect(page.getByTestId("chats-list-empty").first()).toBeVisible({
            timeout: 30_000,
          });
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${folder}/chats-filtered-empty-${size.name}.png` });
          await page.getByTestId("chats-chip-all").click();

          await page.goto("/work");
          await page.getByTestId("work-chip-failed").click();
          await page.waitForTimeout(800);
          await page.screenshot({ path: `${folder}/work-filtered-empty-${size.name}.png` });
          await page.getByTestId("work-chip-all").click();

          await page.goto("/open-project");
          await page.getByTestId("home-chip-failed").click();
          await page.waitForTimeout(800);
          await page.screenshot({ path: `${folder}/home-filtered-empty-${size.name}.png` });
          await page.getByTestId("home-chip-all").click();
        }
      } finally {
        await client.close();
        await workspace.cleanup().catch(() => undefined);
      }
    } finally {
      await daemon.close();
    }
  });
});
