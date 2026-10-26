import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { BOT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import { expect, test as base } from "../support/fixtures";
import { buildSeededHost } from "../support/helpers/daemon-registry";
import { HUB_TEAMMATE, signInToE2EHub } from "../support/helpers/hub-reader";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { connectSeedClient, type SeedDaemonClient } from "../support/helpers/seed-client";
import { createTempDirectory, createTempGitRepo } from "../support/helpers/workspace";

/**
 * Work's scope, pins, Chat-vs-Work and quick chats on a Host shared with a Hub teammate
 * (docs/features/navigation-v2/README.md, Owner review 2026-10-26):
 * - For me hides every session another member authored, pinned or not; pins only reorder.
 * - One pin mark, at the end of the row; no gutter pin, no inline unpin button.
 * - A session is Chat iff it carries a Bot label; Chat sessions never reach Work.
 * - Quick chats are ordinary Work sessions: one "Quick chat" project, interleaved by time.
 * Set NAV_V2_WORK_SHOTS=<folder> to keep screenshots.
 */
base.use({ navigationV2: true });

const SHOTS = process.env.NAV_V2_WORK_SHOTS;
const TITLES = {
  mine: "My sandbox session",
  teammate: "Teammate sandbox session",
  teammatePinned: "Teammate pinned session",
  bot: "Bot chat session",
  release: "Release notes",
  quickA: "Quick chat alpha",
  quickB: "Quick chat beta",
};

interface Fleet {
  serverId: string;
  port: number;
  teammateWorkspaceId: string;
  sandboxWorkspaceId: string;
  releaseWorkspaceId: string;
}

function agentRecord(input: {
  cwd: string;
  workspaceId: string;
  title: string;
  minutesAgo: number;
  createdBy?: SessionActor;
  labels?: Record<string, string>;
}) {
  const at = new Date(Date.now() - input.minutesAgo * 60_000).toISOString();
  return {
    id: randomUUID(),
    provider: "mock",
    cwd: input.cwd,
    workspaceId: input.workspaceId,
    createdAt: at,
    updatedAt: at,
    lastActivityAt: at,
    lastUserMessageAt: at,
    title: input.title,
    labels: input.labels ?? {},
    lastStatus: "idle",
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
  };
}

/** Everything authored before the daemon boots, so sessions carry their author. */
async function seedSharedHost(home: string) {
  const now = new Date().toISOString();
  const sandbox = path.join(home, "uat-product-sandbox");
  const teammate = path.join(home, "teammate-project");
  for (const dir of [
    sandbox,
    teammate,
    path.join(home, "projects"),
    path.join(home, "agents/seed"),
  ])
    await mkdir(dir, { recursive: true });
  const project = (projectId: string, rootPath: string) => ({
    projectId,
    rootPath,
    kind: "non_git",
    displayName: projectId,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
  const workspace = (workspaceId: string, projectId: string, cwd: string, by?: SessionActor) => ({
    workspaceId,
    projectId,
    cwd,
    kind: "directory",
    displayName: workspaceId,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...(by ? { createdBy: by, participantActors: [by] } : {}),
    channels: [],
  });
  await writeFile(
    path.join(home, "projects/projects.json"),
    JSON.stringify([
      project("uat-product-sandbox", sandbox),
      project("teammate-project", teammate),
    ]),
  );
  await writeFile(
    path.join(home, "projects/workspaces.json"),
    JSON.stringify([
      workspace("sandbox-main", "uat-product-sandbox", sandbox),
      workspace("teammate-review", "teammate-project", teammate, HUB_TEAMMATE),
    ]),
  );
  const records = [
    agentRecord({ cwd: sandbox, workspaceId: "sandbox-main", title: TITLES.mine, minutesAgo: 5 }),
    agentRecord({
      cwd: sandbox,
      workspaceId: "sandbox-main",
      title: TITLES.teammate,
      minutesAgo: 3,
      createdBy: HUB_TEAMMATE,
    }),
    agentRecord({
      cwd: sandbox,
      workspaceId: "sandbox-main",
      title: TITLES.bot,
      minutesAgo: 1,
      labels: { [BOT_ID_LABEL]: "bot_e2e" },
    }),
    agentRecord({
      cwd: teammate,
      workspaceId: "teammate-review",
      title: TITLES.teammatePinned,
      minutesAgo: 2,
      createdBy: HUB_TEAMMATE,
    }),
  ];
  for (const record of records)
    await writeFile(path.join(home, "agents/seed", `${record.id}.json`), JSON.stringify(record));
  return { sandboxWorkspaceId: "sandbox-main", teammateWorkspaceId: "teammate-review" };
}

async function createQuickChat(client: SeedDaemonClient, title: string) {
  const prepared = await (
    client as unknown as {
      prepareQuickChat(): Promise<{ cwd?: string; projectId?: string; error: string | null }>;
    }
  ).prepareQuickChat();
  if (!prepared.cwd) throw new Error(prepared.error ?? "Quick chat was not prepared");
  const created = await client.createWorkspace({
    source: { kind: "directory", path: prepared.cwd, projectId: prepared.projectId },
    title,
  });
  if (!created.workspace) throw new Error(created.error ?? "Quick chat workspace failed");
  await client.createAgent({
    provider: "mock",
    cwd: prepared.cwd,
    workspaceId: created.workspace.id,
    title,
    modeId: "load-test",
    model: "e2e-fast-stream",
  });
  return created.workspace.id;
}

const test = base.extend<{ fleet: Fleet }>({
  fleet: async ({ page: _page }, provide) => {
    const home = await createTempDirectory("nav-v2-work-scope-home-");
    const seeded = await seedSharedHost(home.path);
    const daemon = await startIsolatedHostDaemon(`srv_work_scope_${randomUUID().slice(0, 8)}`, {
      clisbotHome: home.path,
      preserveHome: true,
    });
    const client = await connectSeedClient({ port: daemon.port });
    const repo = await createTempGitRepo("nav-v2-work-scope-");
    try {
      await createQuickChat(client, TITLES.quickA);
      const release = await client.createWorkspace({
        source: { kind: "directory", path: repo.path },
        title: TITLES.release,
      });
      if (!release.workspace) throw new Error(release.error ?? "release workspace");
      await client.createAgent({
        provider: "mock",
        cwd: repo.path,
        workspaceId: release.workspace.id,
        title: TITLES.release,
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      await createQuickChat(client, TITLES.quickB);
      // Pinned on the Host by the teammate: the pin travels with the workspace to every reader.
      await client.setWorkspacePinned(seeded.teammateWorkspaceId, true);
      await provide({
        serverId: daemon.serverId,
        port: daemon.port,
        releaseWorkspaceId: release.workspace.id,
        ...seeded,
      });
    } finally {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
      await daemon.close().catch(() => undefined);
      await home.cleanup().catch(() => undefined);
    }
  },
});

async function openWork(page: Page, fleet: Fleet, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await signInToE2EHub(page);
  const host = buildSeededHost({
    serverId: fleet.serverId,
    label: "Shared sandbox",
    endpoint: `127.0.0.1:${fleet.port}`,
    nowIso: new Date().toISOString(),
  });
  await page.addInitScript((seeded) => {
    localStorage.setItem("@clisbot:daemon-registry", JSON.stringify([seeded]));
  }, host);
  await page.goto("/work");
  await expect(work(page)).toBeVisible({ timeout: 60_000 });
}

function work(page: Page): Locator {
  return page.getByTestId("work-pane").filter({ visible: true });
}

async function group(page: Page, mode: "project" | "session" | "workspace") {
  const tab = work(page).getByTestId(`sidebar-view-${mode}`);
  if (await tab.count()) await tab.click();
  else {
    await work(page).getByTestId("sidebar-view-more").click();
    await page.getByTestId(`sidebar-view-more-${mode}`).click();
  }
}

async function scope(page: Page, value: "mine" | "others" | "all") {
  await work(page).getByTestId(`work-scope-${value}`).click();
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  const file = path.join(SHOTS, `${name}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: file });
}

/** The seeded titles in the order the list shows them. */
function titlesIn(locator: Locator) {
  return locator.evaluate((root, wanted) => {
    const text = (root as HTMLElement).innerText;
    return wanted
      .filter((title) => text.includes(title))
      .sort((a, b) => text.indexOf(a) - text.indexOf(b));
  }, Object.values(TITLES));
}

async function expectTitles(page: Page, present: string[], absent: string[]) {
  for (const title of present)
    await expect(work(page).getByText(title, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
  for (const title of absent)
    await expect(work(page).getByText(title, { exact: true })).toHaveCount(0);
}

async function scopeCount(page: Page, value: "mine" | "others" | "all") {
  const label = await work(page).getByTestId(`work-scope-${value}`).innerText();
  return Number(label.trim().split(/\s+/).pop());
}

/** The pinned teammate workspace's row, by its workspace name. */
const TEAMMATE_ROW = "teammate-review";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`Workspace scope, pins, Bots chip and quick chats (${viewport.name})`, async ({
    page,
    fleet,
  }) => {
    test.setTimeout(240_000);
    await openWork(page, fleet, viewport);
    await group(page, "session");
    await scope(page, "mine");
    await shot(page, `${viewport.name}-session-mine`);
    // A1: For me lists the reader's sessions only; the teammate's session and the teammate's
    // pinned workspace are not here. Bot sessions are listed by default (B2).
    await expectTitles(
      page,
      [TITLES.mine, TITLES.release, TITLES.quickA, TITLES.quickB, TITLES.bot],
      [TITLES.teammate, TITLES.teammatePinned, TEAMMATE_ROW],
    );
    // A3/A4: no Quick chats section, nothing behind Show more, no Active filter (B4).
    await expect(work(page).getByTestId("quick-chats-section")).toHaveCount(0);
    await expect(work(page).getByTestId(/show-more/)).toHaveCount(0);
    await expect(page.getByTestId("sidebar-view-active-only")).toHaveCount(0);
    // A3/A4: one list by last update, Quick chats interleaved with everything else.
    const order = await titlesIn(work(page));
    expect(order.indexOf(TITLES.quickB)).toBeLessThan(order.indexOf(TITLES.release));
    expect(order.indexOf(TITLES.release)).toBeLessThan(order.indexOf(TITLES.quickA));
    expect(order.indexOf(TITLES.quickA)).toBeLessThan(order.indexOf(TITLES.mine));

    // B3: the Bots chip hides Bot sessions and the counts follow; it persists.
    const mineWithBots = await scopeCount(page, "mine");
    await work(page).getByTestId("work-bots-chip").click();
    await expect(work(page).getByText(TITLES.bot, { exact: true })).toHaveCount(0);
    await expect.poll(() => scopeCount(page, "mine")).toBe(mineWithBots - 1);
    await shot(page, `${viewport.name}-session-mine-bots-off`);
    await page.reload();
    await expect(work(page)).toBeVisible({ timeout: 60_000 });
    await expect(work(page).getByText(TITLES.mine, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(work(page).getByText(TITLES.bot, { exact: true })).toHaveCount(0);
    await work(page).getByTestId("work-bots-chip").click();
    await expect(work(page).getByText(TITLES.bot, { exact: true }).first()).toBeVisible();

    await scope(page, "others");
    await shot(page, `${viewport.name}-session-others`);
    await expectTitles(
      page,
      [TITLES.teammate, TEAMMATE_ROW],
      [TITLES.mine, TITLES.release, TITLES.quickA, TITLES.bot],
    );
    // A2: the pinned row floats with the one pin mark; no other row carries one.
    const pinned = work(page).getByTestId("pinned-float");
    await expect(pinned).toHaveCount(1);
    await expect(pinned.getByTestId("pin-mark")).toHaveCount(1);
    await expect(work(page).getByTestId("pin-mark")).toHaveCount(1);

    await scope(page, "all");
    await expect(work(page).getByTestId("pin-mark")).toHaveCount(1);

    await group(page, "project");
    await scope(page, "mine");
    await shot(page, `${viewport.name}-project-mine`);
    // A4: Quick chats are one "Quick chat" project; the teammate's pinned workspace stays out.
    await expect(work(page).getByText("Quick chat", { exact: true })).toHaveCount(1);
    await expect(work(page).getByText(TEAMMATE_ROW, { exact: true })).toHaveCount(0);
    await scope(page, "all");
    await shot(page, `${viewport.name}-project-all`);
  });
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];
const shotsDescribe = SHOTS ? test.describe : test.describe.skip;

/** The review set: both groupings with a pinned row in each scope, per theme and language. */
shotsDescribe("Workspace screenshots", () => {
  for (const theme of ["light", "dark"])
    for (const language of ["vi", "en"])
      test(`Project and Session grouping with pins (${theme} · ${language})`, async ({
        page,
        fleet,
      }) => {
        test.setTimeout(300_000);
        // A pin of the reader's own beside the teammate's, so For me shows a pinned row too.
        const client = await connectSeedClient({ port: fleet.port });
        await client.setWorkspacePinned(fleet.releaseWorkspaceId, true);
        await client.close();
        await page.addInitScript(
          (settings) => localStorage.setItem("@clisbot:app-settings", JSON.stringify(settings)),
          { theme, language },
        );
        for (const viewport of VIEWPORTS) {
          await openWork(page, fleet, viewport);
          for (const mode of ["project", "session"] as const) {
            await group(page, mode);
            for (const value of ["mine", "all"] as const) {
              await scope(page, value);
              await expect(work(page).getByTestId("pinned-float").first()).toBeVisible({
                timeout: 30_000,
              });
              await shot(page, `matrix/${theme}-${language}/${viewport.name}-${mode}-${value}`);
            }
          }
        }
      });
});
