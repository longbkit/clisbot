import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { daemonWsRoutePattern, wsRoutePatternForPort } from "../support/helpers/daemon-port";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import {
  startIsolatedHostDaemon,
  type IsolatedHostDaemon,
} from "../support/helpers/isolated-host-daemon";
import { seedWorkspace } from "../support/helpers/seed-client";

/**
 * Navigation V2 Round 2, D6 and D7. D6: once a list has rows it never shows a skeleton, an empty
 * state or nothing again while data refreshes, a Bot changes or its Host reconnects; rows update in
 * place instead of remounting. D7: the Chats skeleton sits on the rows' own rails.
 */

type ListName = "chats" | "work" | "home";

const LISTS: Record<ListName, { pane: string; rows: string; blank: string }> = {
  chats: {
    pane: '[data-testid="chats-list"]',
    rows: '[data-testid^="sidebar-chat-"][data-testid$="-press"], [data-testid^="sidebar-bot-"][data-testid$="-press"]',
    blank:
      '[data-testid="chats-list-placeholder"], [data-testid="chats-list-empty"], [data-testid="chats-offline"], [data-testid="chats-list-error"]',
  },
  work: {
    pane: '[data-testid="work-pane"]',
    rows: '[data-testid^="sidebar-workspace-row-"]',
    blank: '[data-testid="work-offline"], [data-testid="sidebar-filter-empty-state"]',
  },
  home: {
    pane: '[data-testid="home-activity"]',
    rows: '[data-testid^="agent-row-title-"]',
    blank:
      '[data-testid="home-activity-placeholder"], [data-testid="home-feed-empty"], [data-testid="home-feed-offline"]',
  },
};

interface SamplerResult {
  frames: number;
  blankFrames: number;
  firstRows: number;
  minRows: number;
  probeKept: boolean;
}

/** Samples the visible list every frame: its row count, and whether a blank state is drawn. */
async function startSampler(page: Page, list: ListName) {
  await page.evaluate((selectors) => {
    const visible = (element: Element) => element.getBoundingClientRect().height > 0;
    const pane = () => [...document.querySelectorAll(selectors.pane)].find(visible);
    const rows = (root: Element) => [...root.querySelectorAll(selectors.rows)].filter(visible);
    const root = pane();
    const first = root ? rows(root)[0] : undefined;
    if (!root || !first) throw new Error("The list has no rows to watch");
    Reflect.set(first, "__listProbe", true);
    const state = {
      stop: false,
      frames: 0,
      blankFrames: 0,
      firstRows: rows(root).length,
      minRows: Number.POSITIVE_INFINITY,
      probe: first,
    };
    Reflect.set(globalThis, "__listSampler", state);
    const sample = () => {
      if (state.stop) return;
      const current = pane();
      const count = current ? rows(current).length : 0;
      const blank =
        !current || count === 0 || [...current.querySelectorAll(selectors.blank)].some(visible);
      state.frames += 1;
      if (blank) state.blankFrames += 1;
      state.minRows = Math.min(state.minRows, count);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, LISTS[list]);
}

async function stopSampler(page: Page): Promise<SamplerResult> {
  return page.evaluate(() => {
    const state = Reflect.get(globalThis, "__listSampler") as {
      stop: boolean;
      frames: number;
      blankFrames: number;
      firstRows: number;
      minRows: number;
      probe: Element;
    };
    state.stop = true;
    return {
      frames: state.frames,
      blankFrames: state.blankFrames,
      firstRows: state.firstRows,
      minRows: state.minRows,
      probeKept: state.probe.isConnected && Reflect.get(state.probe, "__listProbe") === true,
    };
  });
}

/** The tab focus and visibility events a background refetch listens for. */
async function refocus(page: Page) {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

async function seedHost(daemon: IsolatedHostDaemon) {
  const workspace = await seedWorkspace({ repoPrefix: "nav-v2-list-", port: daemon.port });
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "nav-v2-list",
    port: daemon.port,
  });
  for (const title of ["Release notes", "Billing fix", "Docs pass"])
    await client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title,
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
  const botIds: string[] = [];
  for (const name of ["Nia", "Otto"]) {
    const created = await client.createBot({
      name,
      kind: "personal",
      launch: { provider: "mock", model: "e2e-fast-stream" },
    });
    if (!created.bot) throw new Error(`createBot failed: ${String(created.error)}`);
    botIds.push(created.bot.id);
  }
  const chatIds: string[] = [];
  for (const title of ["Launch room", "Support desk", "Design review"]) {
    const created = await client.createChat({ botIds, title });
    if (created.chat) chatIds.push(created.chat.id);
  }
  return { workspace, client, botIds, chatIds };
}

async function openList(page: Page, list: ListName, compact: boolean) {
  const press = {
    chats: compact ? "home-tab-chat" : "navigation-rail-chats",
    work: compact ? "home-tab-work" : "navigation-rail-work",
    home: compact ? "home-tab-open-project" : "navigation-rail-home",
  }[list];
  await page.getByTestId(press).click();
}

test.describe("Navigation V2 lists keep their rows (D6)", () => {
  test.use({ navigationV2: true });

  test("Chats, Workspace and Home never blank while data refreshes and the Host reconnects", async ({
    page,
  }, info) => {
    test.setTimeout(420_000);
    const serverId = `srv_nav_lists_${randomUUID().slice(0, 8)}`;
    const daemon = await startIsolatedHostDaemon(serverId);
    const seeded = await seedHost(daemon);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, { serverId, label: "List Host", port: daemon.port });
      await openList(page, "chats", false);
      await expect(page.getByText("Design review", { exact: true }).first()).toBeVisible({
        timeout: 60_000,
      });

      // Chats, 60 s: a new chat, a Bot rename, a focus refetch and two Host restarts.
      await startSampler(page, "chats");
      const started = Date.now();
      const at = async (seconds: number) =>
        page.waitForTimeout(Math.max(0, started + seconds * 1000 - Date.now()));
      await at(5);
      await seeded.client.createChat({ botIds: seeded.botIds, title: "Late group" });
      await at(13);
      await seeded.client.updateBot({ botId: seeded.botIds[0]!, name: "Nia renamed" });
      await at(21);
      await refocus(page);
      await at(27);
      await seeded.client.close().catch(() => undefined);
      await daemon.restart();
      await at(42);
      await refocus(page);
      await daemon.restart();
      await at(60);
      const chats = await stopSampler(page);
      await expect(page.getByText("Late group", { exact: true }).first()).toBeVisible();

      // Workspace and Home: one Host restart each.
      const others: Record<string, SamplerResult> = {};
      for (const list of ["work", "home"] as const) {
        await openList(page, list, false);
        await expect(
          page.locator(`${LISTS[list].pane} >> visible=true`).locator(LISTS[list].rows).first(),
        ).toBeVisible({ timeout: 60_000 });
        await startSampler(page, list);
        await page.waitForTimeout(2_000);
        await daemon.restart();
        await page.waitForTimeout(12_000);
        others[list] = await stopSampler(page);
      }

      const results = { chats, ...others };
      await info.attach("list-continuity.json", {
        body: JSON.stringify(results, null, 2),
        contentType: "application/json",
      });
      console.log(`[lists] ${JSON.stringify(results)}`);
      for (const [list, result] of Object.entries(results)) {
        expect(result.frames, list).toBeGreaterThan(100);
        expect(result.blankFrames, list).toBe(0);
        expect(result.minRows, list).toBeGreaterThanOrEqual(result.firstRows);
        expect(result.probeKept, list).toBe(true);
      }
    } finally {
      await seeded.client.close().catch(() => undefined);
      await seeded.workspace.cleanup().catch(() => undefined);
      await daemon.close().catch(() => undefined);
    }
  });
});

type ListingMode = "hold" | "fail" | "pass";

function rpcError(raw: string): string | null {
  const envelope = JSON.parse(raw) as { message?: { type?: string; requestId?: string } };
  const request = envelope.message;
  if (!request?.type || !request.requestId) return null;
  return JSON.stringify({
    type: "session",
    message: {
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: "Injected list failure.",
        code: "handler_error",
      },
    },
  });
}

/**
 * Chat and Bot list requests on the given Hosts' sockets: held until `release`, answered with an
 * error, or passed through. Everything else passes.
 */
async function controlListings(page: Page, patterns: RegExp[], initial: ListingMode) {
  let mode = initial;
  const held: (() => void)[] = [];
  const isListing = (raw: string) =>
    raw.includes('"chat.list.request"') || raw.includes('"bot.list.request"');
  for (const pattern of patterns)
    await page.routeWebSocket(pattern, (browser) => {
      const server = browser.connectToServer();
      browser.onMessage((message) => {
        const raw = typeof message === "string" ? message : message.toString("utf8");
        const failure = mode === "fail" && isListing(raw) ? rpcError(raw) : null;
        if (failure) browser.send(failure);
        else if (mode === "hold" && isListing(raw)) held.push(() => server.send(message));
        else server.send(message);
      });
      server.onMessage((message) => browser.send(message));
    });
  return {
    set(next: ListingMode) {
      mode = next;
    },
    release() {
      mode = "pass";
      for (const send of held.splice(0)) send();
    },
  };
}

/** The drawn height of each row in the visible list; a Home row is the title's whole row. */
async function rowHeights(page: Page, list: ListName): Promise<number[]> {
  const rowOf =
    list === "home" ? '[data-testid^="agent-row-"]:not([data-testid^="agent-row-title-"])' : "*";
  return page
    .locator(`${LISTS[list].pane} >> visible=true`)
    .locator(LISTS[list].rows)
    .evaluateAll(
      (elements, closest) =>
        elements.map((element) =>
          Math.round((element.closest(closest) ?? element).getBoundingClientRect().height),
        ),
      rowOf,
    );
}

/** The section each list sits in; rails are measured from its edge. */
const FRAMES: Record<ListName, string> = {
  chats: '[data-testid="chats-pane"]',
  work: '[data-testid="work-pane"]',
  home: '[data-testid="home-activity"]',
};

/** The first row's geometry relative to its pane: row inset, height, mark and title rails. */
async function rowGeometry(page: Page, list: ListName, rows = LISTS[list].rows) {
  const rowOf =
    list === "home" ? '[data-testid^="agent-row-"]:not([data-testid^="agent-row-title-"])' : "*";
  return page
    .locator(`${LISTS[list].pane} >> visible=true`)
    .locator(rows)
    .first()
    .evaluate(
      (element, input) => {
        const row = element.closest(input.rowOf) ?? element;
        const pane = row.closest(input.frame)!.getBoundingClientRect();
        const box = row.getBoundingClientRect();
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let text: Text | null = null;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          // Avatar initials are tiny text; the title is the first line at reading size.
          const size = parseFloat(getComputedStyle(node.parentElement!).fontSize);
          if (node.textContent?.trim() && size >= 12) {
            text = node;
            break;
          }
        }
        const range = document.createRange();
        if (text) range.selectNodeContents(text);
        const title = text ? range.getBoundingClientRect() : null;
        return {
          rowLeft: Math.round(box.left - pane.left),
          height: Math.round(box.height),
          titleLeft: title ? Math.round(title.left - pane.left) : null,
          titleSize: text ? getComputedStyle(text.parentElement!).fontSize : null,
        };
      },
      { rowOf, frame: FRAMES[list] },
    );
}

const SHOTS = process.env.NAV_V2_LIST_SHOTS;

test.describe("Navigation V2 Chats skeleton (D7)", () => {
  test.use({ navigationV2: true });

  for (const width of [1440, 390]) {
    test(`the skeleton sits on the rows' rails at ${width}px`, async ({ page }, info) => {
      test.setTimeout(240_000);
      const compact = width < 500;
      const serverId = `srv_nav_skeleton_${randomUUID().slice(0, 8)}`;
      const daemon = await startIsolatedHostDaemon(serverId);
      const seeded = await seedHost(daemon);
      const folder = SHOTS ?? info.outputPath("shots");
      mkdirSync(folder, { recursive: true });
      // Chat and Bot lists from this Host wait until the test lets them through.
      const hold = await controlListings(
        page,
        [wsRoutePatternForPort(String(daemon.port))],
        "hold",
      );
      try {
        await page.setViewportSize({ width, height: compact ? 844 : 900 });
        await gotoAppShell(page);
        await addConnectedHostAndReload(page, { serverId, label: "List Host", port: daemon.port });
        await openList(page, "chats", compact);
        const skeleton = page.getByTestId("chats-list-placeholder").filter({ visible: true });
        await expect(skeleton).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `${folder}/chats-loading-${compact ? "phone" : "desktop"}.png`,
        });
        const skeletonRow = await skeleton
          .getByTestId("chats-list-placeholder-row")
          .first()
          .boundingBox();
        const skeletonTitle = await skeleton
          .getByTestId("chats-list-placeholder-title")
          .first()
          .boundingBox();

        hold.release();
        const chatId = seeded.chatIds[2]!;
        const row = page.getByTestId(`sidebar-chat-${chatId}`).filter({ visible: true });
        await expect(row).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `${folder}/chats-loaded-${compact ? "phone" : "desktop"}.png`,
        });
        const rowBox = await row.boundingBox();
        const titleBox = await row.getByText("Design review", { exact: true }).boundingBox();
        const measured = { skeletonRow, skeletonTitle, rowBox, titleBox };
        console.log(`[skeleton ${width}] ${JSON.stringify(measured)}`);
        expect(skeletonRow && rowBox && skeletonTitle && titleBox).toBeTruthy();
        // Same row inset, width and title rail: loading → loaded does not shift sideways.
        expect(Math.abs(skeletonRow!.x - rowBox!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(skeletonRow!.width - rowBox!.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(skeletonTitle!.x - titleBox!.x)).toBeLessThanOrEqual(1);

        // F6: the chip row scrolls under the pane's own edges and fades where more chips wait.
        const chipRow = await page
          .getByTestId("chats-chip")
          .filter({ visible: true })
          .evaluate((chips) => {
            const scroller = chips.parentElement!.parentElement!;
            const pane = chips.closest('[data-testid="chats-controls"]')!.getBoundingClientRect();
            const box = scroller.getBoundingClientRect();
            return {
              left: box.left - pane.left,
              right: pane.right - box.right,
              overflows: scroller.scrollWidth > scroller.clientWidth + 1,
              fades: scroller.parentElement!.querySelectorAll("svg").length,
            };
          });
        console.log(`[chip row ${width}] ${JSON.stringify(chipRow)}`);
        expect(chipRow.left).toBe(0);
        expect(chipRow.right).toBe(0);
        if (chipRow.overflows) expect(chipRow.fades).toBeGreaterThan(0);
      } finally {
        hold.release();
        await seeded.client.close().catch(() => undefined);
        await seeded.workspace.cleanup().catch(() => undefined);
        await daemon.close().catch(() => undefined);
      }
    });
  }
});

test.describe("Navigation V2 Chats error and row rails (D2: V5, V3)", () => {
  test.use({ navigationV2: true });

  for (const width of [1440, 390]) {
    test(`Chats says it failed and Retry recovers; rows keep one height at ${width}px`, async ({
      page,
    }, info) => {
      test.setTimeout(240_000);
      const compact = width < 500;
      const size = compact ? "phone" : "desktop";
      const serverId = `srv_nav_error_${randomUUID().slice(0, 8)}`;
      const daemon = await startIsolatedHostDaemon(serverId);
      const seeded = await seedHost(daemon);
      const folder = SHOTS ?? info.outputPath("shots");
      mkdirSync(folder, { recursive: true });
      // Every Host's chat and Bot lists fail, so Chats has nothing to show but the error.
      const listings = await controlListings(
        page,
        [wsRoutePatternForPort(String(daemon.port)), daemonWsRoutePattern()],
        "fail",
      );
      try {
        await page.setViewportSize({ width, height: compact ? 844 : 900 });
        await gotoAppShell(page);
        await addConnectedHostAndReload(page, { serverId, label: "List Host", port: daemon.port });
        await openList(page, "chats", compact);
        const error = page.getByTestId("chats-list-error").filter({ visible: true });
        await expect(error).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${folder}/chats-error-${size}.png` });

        listings.set("pass");
        await error.getByTestId("chats-list-error-action").click();
        await expect(
          page.getByTestId(`sidebar-chat-${seeded.chatIds[0]!}`).filter({ visible: true }),
        ).toBeVisible({ timeout: 60_000 });
        await page.screenshot({ path: `${folder}/chats-retried-${size}.png` });

        // V3: within a list, every row of a kind is one height.
        const heights: Record<string, number[]> = {};
        const geometry: Record<string, Awaited<ReturnType<typeof rowGeometry>>> = {};
        for (const list of ["chats", "work", "home"] as const) {
          if (list !== "chats") await openList(page, list, compact);
          const rows = page
            .locator(`${LISTS[list].pane} >> visible=true`)
            .locator(LISTS[list].rows);
          await expect(rows.first()).toBeVisible({ timeout: 60_000 });
          heights[list] = await rowHeights(page, list);
          geometry[list] = await rowGeometry(page, list);
        }
        console.log(`[row heights ${width}] ${JSON.stringify(heights)}`);
        console.log(`[row geometry ${width}] ${JSON.stringify(geometry)}`);
        await info.attach(`row-heights-${size}.json`, {
          body: JSON.stringify(heights),
          contentType: "application/json",
        });
        // Workspace's Session grouping is the virtualized flat list; it keeps the same rail.
        await openList(page, "work", compact);
        await page
          .getByTestId("work-pane")
          .filter({ visible: true })
          .getByTestId("sidebar-view-session")
          .click();
        const sessionRail = (
          await rowGeometry(page, "work", '[data-testid^="sidebar-workspace-session-"]')
        ).titleLeft;
        console.log(`[session rail ${width}] ${sessionRail}`);
        expect(sessionRail).toBe(geometry.work!.titleLeft);

        // V3: one row height and one title rail across Chats, Workspace and the Home feed.
        const all = Object.values(heights).flat();
        expect(new Set(all).size, JSON.stringify(heights)).toBe(1);
        const rails = Object.values(geometry).map((entry) => entry.titleLeft);
        expect(new Set(rails).size, JSON.stringify(geometry)).toBe(1);
      } finally {
        listings.release();
        await seeded.client.close().catch(() => undefined);
        await seeded.workspace.cleanup().catch(() => undefined);
        await daemon.close().catch(() => undefined);
      }
    });
  }
});
