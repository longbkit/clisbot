import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, metroTest as test } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { buildCreateAgentPreferences, buildSeededHost } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace } from "../support/helpers/seed-client";

// Navigation V2 acceptance P2/P4/P5 on web (docs/features/navigation-v2/README.md#verification).
// An isolated daemon holds synthetic data: 500 sessions (Work, Home) and 500 group chats (Chats).
// Opt in with CLISBOT_NAV_V2_PERF_E2E=1; numbers land in the console and the test attachments.
const RUN = process.env.CLISBOT_NAV_V2_PERF_E2E === "1";
const SESSIONS = Number(process.env.CLISBOT_NAV_V2_PERF_SESSIONS ?? 500);
const CHATS = Number(process.env.CLISBOT_NAV_V2_PERF_CHATS ?? 500);
const HOME_ITEMS = 200;
const SWITCHES = 20;
const BATCH = 25;

interface Seeded {
  serverId: string;
  port: number;
  client: DaemonClient;
  chatIds: string[];
  agentIds: string[];
  close(): Promise<void>;
}

async function inBatches<T>(count: number, make: (index: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < count; start += BATCH) {
    const size = Math.min(BATCH, count - start);
    out.push(...(await Promise.all(Array.from({ length: size }, (_, i) => make(start + i)))));
  }
  return out;
}

async function seedSyntheticHost(): Promise<Seeded> {
  const serverId = `srv_nav_perf_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const daemon = await startIsolatedHostDaemon(serverId);
  const workspace = await seedWorkspace({ repoPrefix: "nav-v2-perf-", port: daemon.port });
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "nav-v2-perf",
    port: daemon.port,
  });
  const agents = await inBatches(SESSIONS, (i) =>
    client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: `Synthetic session ${String(i).padStart(3, "0")}`,
      modeId: "load-test",
      model: "e2e-fast-stream",
    }),
  );
  // A chat with one Bot is that Bot's direct chat; a group needs two.
  const botIds = await Promise.all(
    ["Synthetic bot A", "Synthetic bot B"].map(async (name) => {
      const bot = await client.createBot({
        name,
        kind: "personal",
        launch: { provider: "mock", model: "e2e-fast-stream" },
      });
      if (!bot.bot) throw new Error(`createBot failed: ${String(bot.error)}`);
      return bot.bot.id;
    }),
  );
  const chats = await inBatches(CHATS, (i) =>
    client.createChat({ botIds, title: `Synthetic group ${String(i).padStart(3, "0")}` }),
  );
  return {
    serverId,
    port: daemon.port,
    client,
    agentIds: agents.map((agent) => agent.id),
    chatIds: chats.flatMap((chat) => (chat.chat ? [chat.chat.id] : [])),
    close: async () => {
      await client.close().catch(() => undefined);
      await workspace.cleanup().catch(() => undefined);
      await daemon.close();
    },
  };
}

async function openApp(page: Page, seeded: Seeded) {
  const host = buildSeededHost({
    serverId: seeded.serverId,
    endpoint: `127.0.0.1:${seeded.port}`,
    nowIso: new Date().toISOString(),
  });
  await page.route(/:(6767|6768|6868|6869)\b/, (route) => route.abort());
  await page.routeWebSocket(/:(6767|6768|6868|6869)\b/, async (socket) => {
    await socket.close({ code: 1008, reason: "Blocked developer daemon during e2e." });
  });
  await page.addInitScript(
    ({ seededHost, preferences }) => {
      localStorage.setItem("@clisbot:e2e", "1");
      localStorage.setItem("@clisbot:navigation-v2", "1");
      localStorage.setItem("@clisbot:daemon-registry", JSON.stringify([seededHost]));
      localStorage.setItem("@clisbot:create-agent-preferences", JSON.stringify(preferences));
      Reflect.set(globalThis, "__CLISBOT_RENDER_PROFILE_ENABLED__", true);
    },
    { seededHost: host, preferences: buildCreateAgentPreferences() },
  );
  await page.goto("/");
}

/** Press → first animation frame that shows the target, and whether any frame showed nothing. */
async function measureSwitch(page: Page, press: string, target: string, panes: string[]) {
  await page.evaluate(
    ({ target: wanted, panes: known }) => {
      const state = { t0: 0, t1: 0, blank: false };
      Reflect.set(window, "__navSwitch", state);
      const shown = (id: string) => {
        const node = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        return Boolean(node && node.getClientRects().length > 0);
      };
      window.addEventListener("pointerdown", () => (state.t0 = performance.now()), {
        capture: true,
        once: true,
      });
      const tick = () => {
        if (state.t0 && shown(wanted)) {
          state.t1 = performance.now();
          return;
        }
        if (state.t0 && !known.some(shown)) state.blank = true;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { target, panes },
  );
  await page.getByTestId(press).first().click();
  await page.waitForFunction(
    () => (Reflect.get(window, "__navSwitch") as { t1: number }).t1 > 0,
    undefined,
    { timeout: 15_000 },
  );
  return page.evaluate(() => {
    const state = Reflect.get(window, "__navSwitch") as { t0: number; t1: number; blank: boolean };
    return { ms: state.t1 - state.t0, blank: state.blank };
  });
}

/** Wheel-scrolls the element for `durationMs` and returns animation-frame gaps. */
async function measureScroll(page: Page, testID: string, durationMs = 3_000) {
  const box = await page.getByTestId(testID).first().boundingBox();
  if (!box) throw new Error(`${testID} is not on screen`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    const frames: number[] = [];
    Reflect.set(window, "__navFrames", frames);
    let last = performance.now();
    const tick = (now: number) => {
      frames.push(now - last);
      last = now;
      if (Reflect.get(window, "__navFrames") === frames) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const until = Date.now() + durationMs;
  let direction = 1;
  while (Date.now() < until) {
    await page.mouse.wheel(0, 120 * direction);
    await page.waitForTimeout(16);
    const atEnd = await page
      .getByTestId(testID)
      .first()
      .evaluate((node, down) => {
        const scroller = [node, ...node.querySelectorAll<HTMLElement>("*")].find(
          (el) =>
            el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== "visible",
        );
        if (!scroller) return false;
        return down
          ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
          : scroller.scrollTop <= 0;
      }, direction === 1);
    if (atEnd) direction = -direction;
  }
  const frames = await page.evaluate(() => {
    const list = Reflect.get(window, "__navFrames") as number[];
    Reflect.set(window, "__navFrames", null);
    return list.slice(2);
  });
  return summarizeFrames(frames);
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function summarizeFrames(frames: number[]) {
  const median = percentile(frames, 50);
  return {
    frames: frames.length,
    medianFps: Math.round((1000 / Math.max(median, 1)) * 10) / 10,
    p95FrameMs: Math.round(percentile(frames, 95) * 10) / 10,
    maxFrameMs: Math.round(Math.max(0, ...frames) * 10) / 10,
    over50ms: frames.filter((gap) => gap > 50).length,
  };
}

async function resetProfile(page: Page) {
  await page.evaluate(() => {
    Reflect.set(globalThis, "__CLISBOT_RENDER_PROFILE__", []);
  });
}

async function profiledIds(page: Page, prefix: string) {
  return page.evaluate((wanted) => {
    const samples = (Reflect.get(globalThis, "__CLISBOT_RENDER_PROFILE__") ?? []) as {
      id: string;
      phase: string;
      actualDuration: number;
    }[];
    const hits = samples.filter((sample) => sample.id.startsWith(wanted));
    return {
      ids: [...new Set(hits.map((sample) => sample.id))],
      commits: hits.length,
      maxMs: Math.round(Math.max(0, ...hits.map((s) => s.actualDuration)) * 10) / 10,
    };
  }, prefix);
}

const perfDescribe = RUN ? test.describe : test.describe.skip;

perfDescribe("Navigation V2 performance (synthetic 500 sessions / 500 chats)", () => {
  test.describe.configure({ mode: "serial" });
  let seeded: Seeded;
  const report: Record<string, unknown> = {};

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    const started = Date.now();
    seeded = await seedSyntheticHost();
    report.seed = {
      sessions: seeded.agentIds.length,
      chats: seeded.chatIds.length,
      seconds: Math.round((Date.now() - started) / 1000),
    };
  });

  test.afterAll(async () => {
    console.log(`[perf] Navigation V2: ${JSON.stringify(report)}`);
    await seeded?.close();
  });

  test("desktop: rail switch, list scroll and row re-renders", async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, seeded);
    await page.getByTestId("navigation-rail-chats").click();
    await expect(page.getByTestId(`chats-chip-all`)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("chats-list")).toContainText("Synthetic group", {
      timeout: 120_000,
    });

    // P2: rail switches, each measured to the first frame of the new list pane.
    const panes = ["chats-pane", "work-pane", "home-controls"];
    const switches: number[] = [];
    let blank = 0;
    const order = [
      ["navigation-rail-work", "work-pane"],
      ["navigation-rail-chats", "chats-pane"],
      ["navigation-rail-home", "home-controls"],
    ] as const;
    for (let i = 0; i < SWITCHES; i += 1) {
      const [press, target] = order[i % order.length]!;
      const result = await measureSwitch(page, press, target, panes);
      switches.push(result.ms);
      if (result.blank) blank += 1;
      await page.waitForTimeout(150);
    }
    report.desktopSwitch = {
      count: switches.length,
      p50Ms: Math.round(percentile(switches, 50)),
      p95Ms: Math.round(percentile(switches, 95)),
      maxMs: Math.round(Math.max(...switches)),
      blankFrames: blank,
    };

    // P4: 500-row Chats list.
    await page.getByTestId("navigation-rail-chats").click();
    await expect(page.getByTestId("chats-pane")).toBeVisible();
    report.chatsScroll = await measureScroll(page, "chats-list");

    // P5: rename one chat; no other Chats row may re-render.
    await resetProfile(page);
    const target = seeded.chatIds[0]!;
    await seeded.client.updateChat({ chatId: target, patch: { title: "Synthetic group renamed" } });
    await expect(page.getByTestId("chats-list")).toContainText("Synthetic group renamed", {
      timeout: 30_000,
    });
    await page.waitForTimeout(1_000);
    const chatRows = await profiledIds(page, "ChatsRow:");
    report.chatsRowRerenders = {
      ...chatRows,
      unaffected: chatRows.ids.filter((id) => !id.includes(target)).length,
    };

    // P4: 500 sessions in Work, one line each (Grouping → Session).
    await page.getByTestId("navigation-rail-work").click();
    await expect(page.getByTestId("work-pane")).toBeVisible();
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await page.getByTestId("sidebar-display-grouping").click();
    await page.getByTestId("sidebar-grouping-session").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("work-pane")).toContainText("Synthetic session", {
      timeout: 60_000,
    });
    report.workScroll = await measureScroll(page, "work-pane");

    // P4: the Home feed with 200 items revealed.
    await page.getByTestId("navigation-rail-home").click();
    const more = page.getByTestId("home-activity-show-more");
    for (let shown = 10; shown < HOME_ITEMS && (await more.isVisible()); shown += 10) {
      await more.click();
    }
    await resetProfile(page);
    report.homeScroll = await measureScroll(page, "home-scroll");
    report.homeRows = await page.locator('[data-testid^="agent-row-"]').count();

    // P5: one session changes; other Home rows stay put.
    await resetProfile(page);
    const changed = seeded.agentIds[0]!;
    await seeded.client.updateAgent(changed, { name: "Synthetic session renamed" });
    await page.waitForTimeout(2_000);
    const homeRows = await profiledIds(page, "HomeRow:");
    report.homeRowRerenders = {
      ...homeRows,
      unaffected: homeRows.ids.filter((id) => !id.includes(changed)).length,
    };

    await testInfo.attach("navigation-v2-performance", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
  });

  test("phone: tab switch", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, seeded);
    await expect(page.getByTestId("home-mobile-tabs")).toBeVisible({ timeout: 60_000 });
    const panes = ["chats-pane", "work-pane", "home-controls", "more-screen"];
    const order = [
      ["home-tab-chat", "chats-pane"],
      ["home-tab-work", "work-pane"],
      ["home-tab-more", "more-screen"],
      ["home-tab-open-project", "home-controls"],
    ] as const;
    const switches: number[] = [];
    let blank = 0;
    for (let i = 0; i < SWITCHES; i += 1) {
      const [press, target] = order[i % order.length]!;
      const result = await measureSwitch(page, press, target, panes);
      switches.push(result.ms);
      if (result.blank) blank += 1;
      await page.waitForTimeout(150);
    }
    report.phoneSwitch = {
      count: switches.length,
      p50Ms: Math.round(percentile(switches, 50)),
      p95Ms: Math.round(percentile(switches, 95)),
      maxMs: Math.round(Math.max(...switches)),
      blankFrames: blank,
    };
    await testInfo.attach("navigation-v2-performance-phone", {
      body: JSON.stringify(report.phoneSwitch, null, 2),
      contentType: "application/json",
    });
  });
});
