import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test as base } from "../support/fixtures";
import { buildSeededHost } from "../support/helpers/daemon-registry";
import {
  startIsolatedHostDaemon,
  type IsolatedHostDaemon,
} from "../support/helpers/isolated-host-daemon";
import { gotoAppShell } from "../support/helpers/app";
import { HUB_TEAMMATE, signInToE2EHub } from "../support/helpers/hub-reader";
import { connectSeedClient, type SeedDaemonClient } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { createTempDirectory, createTempGitRepo } from "../support/helpers/workspace";

/**
 * Global search wired into Navigation V2 (docs/features/global-search/README.md): Work publishes
 * its filter, "Show in Work" opens the V2 Work section with Undo, and opening an item Work (or
 * Chats) hides shows the outside-filter notice without changing the filter (R3, R4).
 */
base.use({ navigationV2: true });

const SANDBOX = "sandbox-12";
const SCREENSHOTS = process.env.GS_SCREENSHOTS === "1";
const ARTIFACTS = path.resolve(__dirname, "../../../../artifacts/global-search");

/** A teammate on the same Hub: their workspace is "Others" for the reader. */
const TEAMMATE = HUB_TEAMMATE;

interface Fleet {
  sandbox: { serverId: string; label: string; port: number };
  primaryWorkspaceId: string;
  sandboxWorkspaceId: string;
  othersWorkspaceId: string;
}

/** The teammate's workspace, written before the sandbox daemon boots so it carries an author. */
async function seedTeammateWorkspace(home: string): Promise<string> {
  const now = new Date().toISOString();
  const cwd = path.join(home, "teammate-review");
  await mkdir(cwd, { recursive: true });
  await mkdir(path.join(home, "projects"), { recursive: true });
  const project = {
    projectId: "teammate-project",
    rootPath: cwd,
    kind: "non_git",
    displayName: "teammate-project",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  const workspace = {
    workspaceId: "teammate-review",
    projectId: "teammate-project",
    cwd,
    kind: "directory",
    displayName: "Teammate review",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    createdBy: TEAMMATE,
    participantActors: [TEAMMATE],
    channels: [],
  };
  await writeFile(path.join(home, "projects/projects.json"), JSON.stringify([project]));
  await writeFile(path.join(home, "projects/workspaces.json"), JSON.stringify([workspace]));
  return workspace.workspaceId;
}

async function createProject(
  client: SeedDaemonClient,
  name: string,
  title: string,
  prefix: string,
) {
  const repo = await createTempGitRepo(prefix);
  const created = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
    title,
  });
  if (!created.workspace) throw new Error(created.error ?? `Failed to create ${name}`);
  await client.renameProject(created.workspace.projectId, name);
  return { ...created.workspace, repo };
}

const test = base.extend<{ fleet: Fleet }>({
  fleet: async ({ page: _page }, provide) => {
    const home = await createTempDirectory("gs-v2-sandbox-home-");
    const othersWorkspaceId = await seedTeammateWorkspace(home.path);
    const sandbox: IsolatedHostDaemon = await startIsolatedHostDaemon("gs-v2-sandbox", {
      clisbotHome: home.path,
      preserveHome: true,
    });
    const primary = await connectSeedClient();
    const secondary = await connectSeedClient({ port: sandbox.port });
    const made: { client: SeedDaemonClient; projectId: string; cleanup(): Promise<void> }[] = [];
    try {
      const local = await createProject(primary, "clisbot", "release notes", "gs-v2-local-");
      made.push({ client: primary, projectId: local.projectId, cleanup: local.repo.cleanup });
      const remote = await createProject(secondary, "clisbot", "release train", "gs-v2-remote-");
      made.push({ client: secondary, projectId: remote.projectId, cleanup: remote.repo.cleanup });
      await provide({
        sandbox: { serverId: sandbox.serverId, label: SANDBOX, port: sandbox.port },
        primaryWorkspaceId: local.id,
        sandboxWorkspaceId: remote.id,
        othersWorkspaceId,
      });
    } finally {
      for (const entry of made) {
        await entry.client.removeProject(entry.projectId).catch(() => undefined);
        await entry.cleanup().catch(() => undefined);
      }
      await primary.close().catch(() => undefined);
      await secondary.close().catch(() => undefined);
      await sandbox.close().catch(() => undefined);
      await home.cleanup().catch(() => undefined);
    }
  },
});

/**
 * The sandbox goes in the harness's extra-Hosts list, which the seed merges on every navigation,
 * so it survives the reloads a language switch needs.
 */
async function openFleet(page: Page, fleet: Fleet, options: { hub?: boolean } = {}) {
  if (options.hub) await signInToE2EHub(page);
  await gotoAppShell(page);
  const sandbox = buildSeededHost({
    serverId: fleet.sandbox.serverId,
    label: fleet.sandbox.label,
    endpoint: `127.0.0.1:${fleet.sandbox.port}`,
    nowIso: new Date().toISOString(),
  });
  await page.evaluate((host) => {
    localStorage.setItem("@clisbot:e2e-extra-hosts", JSON.stringify([host]));
  }, sandbox);
  await gotoWork(page);
}

async function gotoWork(page: Page) {
  await page.goto("/work");
  await expect(page.getByTestId("work-pane").filter({ visible: true })).toBeVisible({
    timeout: 60_000,
  });
}

async function setWorkFilter(page: Page, hostFilters: string[]) {
  await page.evaluate((ids) => {
    const raw = JSON.parse(localStorage.getItem("sidebar-view") ?? "{}");
    raw.state = { ...raw.state, hostFilters: ids, projectFilters: [] };
    localStorage.setItem("sidebar-view", JSON.stringify(raw));
  }, hostFilters);
  await gotoWork(page);
}

function storedFilters(page: Page) {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("sidebar-view") ?? "{}").state ?? {};
    return { hosts: state.hostFilters ?? [], projects: state.projectFilters ?? [] };
  });
}

async function openSearch(page: Page): Promise<Locator> {
  await page.getByTestId("work-search").filter({ visible: true }).first().click();
  const panel = page.getByTestId("command-center-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

async function openFromSearch(page: Page, query: string, rowTestId: string) {
  const panel = await openSearch(page);
  await panel.getByTestId("command-center-input").fill(query);
  const row = panel.getByTestId(rowTestId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByTestId("command-center-panel")).toHaveCount(0);
}

/**
 * Rows whose note is cut off. The note may share a line with a long Host or project name; the name
 * gives way, not the note.
 */
function clippedNotes(notes: Locator, note: string) {
  return notes.evaluateAll((elements, wanted) => {
    const clipped: string[] = [];
    for (const element of elements) {
      const text = element.textContent ?? "";
      const node = element.firstChild;
      const start = text.indexOf(wanted);
      if (start < 0 || !node?.textContent) continue;
      const range = document.createRange();
      range.setStart(node, Math.min(start, node.textContent.length));
      range.setEnd(node, node.textContent.length);
      const shown = element.getBoundingClientRect();
      const needed = range.getBoundingClientRect();
      if (needed.right > shown.right + 1 || element.scrollWidth > element.clientWidth + 1)
        clipped.push(text);
    }
    return clipped;
  }, note);
}

const workNotice = (page: Page) =>
  page.getByTestId("work-outside-filter-notice").filter({ visible: true });

test.describe("Global search in Navigation V2", () => {
  test.describe.configure({ timeout: 240_000 });

  test("opening a session outside Work's Host filter keeps the filter and offers Switch", async ({
    page,
    fleet,
  }) => {
    await openFleet(page, fleet);
    await setWorkFilter(page, [getServerId()]);
    const open = () =>
      openFromSearch(
        page,
        "release train",
        `command-center-workspace-${fleet.sandbox.serverId}:${fleet.sandboxWorkspaceId}`,
      );
    await open();
    await expect(page).toHaveURL(new RegExp(`/workspace/${fleet.sandboxWorkspaceId}`));
    await expect(workNotice(page)).toContainText("This workspace is outside your filter");
    expect((await storedFilters(page)).hosts).toEqual([getServerId()]);
    await capture(page, "05-work-notice-host", open);
    await page.getByTestId("work-notice-switch").filter({ visible: true }).click();
    await expect
      .poll(async () => (await storedFilters(page)).hosts)
      .toEqual([fleet.sandbox.serverId]);
    await expect(workNotice(page)).toHaveCount(0);
  });

  test("on a 390pt phone the Outside filter note stays readable on every out-of-filter row", async ({
    page,
    fleet,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFleet(page, fleet);
    await setWorkFilter(page, [getServerId()]);
    for (const [language, note] of [
      ["en", "Outside filter"],
      ["vi", "Ngoài bộ lọc"],
    ] as const) {
      await setLanguage(page, language);
      await gotoWork(page);
      const panel = await openSearch(page);
      await panel.getByTestId("command-center-input").fill("release");
      const notes = panel.getByText(note, { exact: false });
      await expect(notes.first()).toBeVisible({ timeout: 30_000 });
      const clipped = await clippedNotes(notes, note);
      if (SCREENSHOTS)
        await page.screenshot({
          path: path.join(ARTIFACTS, `08-outside-filter-row-phone-390-light-${language}.png`),
        });
      expect(clipped).toEqual([]);
      await page.keyboard.press("Escape");
    }
    await setLanguage(page, "en");
  });

  test("Show in Work opens the V2 Work section with that scope, and Undo restores", async ({
    page,
    fleet,
  }) => {
    await openFleet(page, fleet);
    await setWorkFilter(page, [getServerId()]);
    await page.goto("/open-project");
    await page.keyboard.press("ControlOrMeta+K");
    const panel = page.getByTestId("command-center-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByTestId("command-center-input").fill(`clisbot ${SANDBOX}`);
    await expect(
      panel.getByTestId(`command-center-scope-project-clisbot-${fleet.sandbox.serverId}`),
    ).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page).toHaveURL(/\/work$/);
    await expect
      .poll(async () => (await storedFilters(page)).hosts)
      .toEqual([fleet.sandbox.serverId]);
    expect((await storedFilters(page)).projects.length).toBeGreaterThan(0);
    await page.getByTestId("search-scope-undo").click();
    await expect.poll(() => storedFilters(page)).toEqual({ hosts: [getServerId()], projects: [] });
  });

  test("an Others item opens without changing For me, and Work says Shown from Others", async ({
    page,
    fleet,
  }) => {
    await openFleet(page, fleet, { hub: true });
    await expect(page.getByTestId("work-scope-mine").filter({ visible: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const rowId = `command-center-workspace-${fleet.sandbox.serverId}:${fleet.othersWorkspaceId}`;
    const panel = await openSearch(page);
    await panel.getByTestId("command-center-input").fill("teammate review");
    await expect(panel.getByTestId(rowId)).toContainText("Others", { timeout: 30_000 });
    await panel.getByTestId(rowId).click();
    await expect(workNotice(page)).toContainText("Shown from Others");
    await expect(page.getByTestId("work-notice-switch")).toHaveCount(0);
    await expect(page.getByTestId("work-scope-mine").filter({ visible: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await capture(page, "06-work-notice-others", () =>
      openFromSearch(page, "teammate review", rowId),
    );
    await page.getByTestId("work-notice-show-all").filter({ visible: true }).click();
    await expect(page.getByTestId("work-scope-all").filter({ visible: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(workNotice(page)).toHaveCount(0);
  });
});

/**
 * The notice in the evidence matrix: desktop 1440 and phone 390, light, en and vi. The reveal
 * lives in memory, so each shot replays the search after the reload a language switch needs; on a
 * phone the reader then goes back to the Work tab, where the notice sits above the list.
 */
async function capture(page: Page, name: string, reopen: () => Promise<void>) {
  if (!SCREENSHOTS) return;
  const viewport = page.viewportSize();
  await page.emulateMedia({ colorScheme: "light" });
  for (const language of ["en", "vi"] as const) {
    await setLanguage(page, language);
    for (const size of [
      { label: "desktop-1440", width: 1440, height: 900 },
      { label: "phone-390", width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await gotoWork(page);
      await reopen();
      // A phone's detail page has Back to the list it came from, not tabs.
      if (size.width < 500) await page.getByTestId("chat-back").filter({ visible: true }).click();
      await expect(workNotice(page)).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(ARTIFACTS, `${name}-${size.label}-light-${language}.png`),
      });
    }
  }
  await setLanguage(page, "en");
  if (viewport) await page.setViewportSize(viewport);
  await gotoWork(page);
  await reopen();
  await expect(workNotice(page)).toBeVisible({ timeout: 30_000 });
}

async function setLanguage(page: Page, language: "en" | "vi") {
  await page.evaluate((value) => {
    const settings = JSON.parse(localStorage.getItem("@clisbot:app-settings") ?? "{}");
    localStorage.setItem("@clisbot:app-settings", JSON.stringify({ ...settings, language: value }));
  }, language);
}
