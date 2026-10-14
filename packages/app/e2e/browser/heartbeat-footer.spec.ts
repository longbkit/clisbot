import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { HeartbeatRun } from "@clisbot/protocol/schedule/heartbeat-notice";
import type { StoredSchedule } from "@clisbot/protocol/schedule/types";
import { formatHeartbeatRunNotice } from "@clisbot/protocol/schedule/heartbeat-notice";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import { seedMockAgentWorkspace, openAgentRoute } from "../support/helpers/mock-agent";
import { TranscriptLog } from "../../../server/src/server/chats/transcript-log";

test.use({
  e2eDaemonEnvironment: {
    CLISBOT_TAILSCALE_BIN: process.execPath,
    CLISBOT_AGENT_SESSION_STORAGE: "1",
  },
});
test.describe.configure({ timeout: 120_000 });

const saved: HeartbeatRun = {
  scheduleId: "footer-fixture",
  name: "Saved heartbeat name",
  run: 2,
  maxRuns: 1095,
};
const at = "2026-10-14T00:00:00.000Z";

// Inert persisted fixtures only. No schedule RPC mutation, scheduler tick or execution.
async function seedPausedSchedule(agentId: string, chatId?: string) {
  const schedule: StoredSchedule = {
    id: saved.scheduleId,
    name: "Current renamed heartbeat",
    prompt: "Inert footer fixture; never execute",
    cadence: { type: "every", everyMs: 86_400_000 },
    target: { type: "agent", agentId, ...(chatId ? { chatId } : {}) },
    status: "paused",
    createdAt: at,
    updatedAt: at,
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: at,
    expiresAt: null,
    maxRuns: 2000,
    runs: [],
  };
  const dir = path.join(process.env.E2E_CLISBOT_HOME!, "schedules");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${saved.scheduleId}.json`), JSON.stringify(schedule));
  return schedule;
}

async function captureFrames(page: Page) {
  const frames: unknown[] = [];
  await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((payload) => server.send(payload));
    server.onMessage((payload) => {
      const envelope = JSON.parse(String(payload));
      const message = envelope.type === "session" ? envelope.message : envelope;
      if (
        [
          "schedule.inspect",
          "schedule.inspect.response",
          "schedule_inspect_response",
          "fetch_agent_timeline_response",
          "chat.transcript",
          "agent_stream",
          "rpc_error",
        ].some((type) => message.type.startsWith(type)) ||
        String(message.type).includes("schedule")
      )
        frames.push(message);
      socket.send(payload);
    });
  });
  return frames;
}

async function settledSheet(page: Page) {
  let previous = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        const box = await page.getByTestId("schedule-detail-sheet").boundingBox();
        const current = JSON.stringify(box && Object.values(box).map((value) => Math.round(value)));
        stable = box && current === previous ? stable + 1 : 0;
        previous = current;
        return stable;
      },
      { intervals: [100], timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(3);
}

for (const phone of [false, true])
  test.describe(phone ? "phone-web touch" : "desktop", () => {
    test.use(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true } : {});
    for (const kind of ["direct", "group"] as const) {
      test(`${kind} saved heartbeat metadata reveals on hover/focus and opens the exact detail`, async ({
        page,
      }, testInfo) => {
        const frames = await captureFrames(page);
        const client = await connectDaemonClient<DaemonClient>({
          clientIdPrefix: "footer-history",
        });
        const created = await client.createBot({
          name: "Footer fixture Bot",
          launch: { provider: "mock", model: "e2e-fast-stream", modeId: "load-test" },
        });
        if (!created.bot) throw new Error(created.error ?? "Bot fixture failed");
        const bot = created.bot;
        let chatId: string | undefined;
        try {
          const result = await client.createChat({ kind, botIds: [bot.id] });
          if (!result.chat) throw new Error(result.error ?? "Chat fixture failed");
          chatId = result.chat.id;
          // A synthetic ID is enough for inspect; no Bot session is created or run here.
          const schedule = await seedPausedSchedule("77777777-7777-4777-8777-777777777777", chatId);
          const log = new TranscriptLog(path.join(process.env.E2E_CLISBOT_HOME!, "chats", chatId));
          await log.append({
            id: "scheduled-input",
            at,
            sender: {
              kind: "user",
              displayName: formatHeartbeatRunNotice({
                title: saved.name!,
                run: saved.run,
                maxRuns: saved.maxRuns!,
              }),
            },
            text: "Hidden scheduled input",
            scheduleRun: saved,
            hop: 0,
          });
          await log.append({
            id: "heartbeat-response",
            at: "2026-10-14T00:01:51.000Z",
            sender: { kind: "bot", botId: bot.id },
            text: "Heartbeat response belongs to run two.",
            inReplyTo: "scheduled-input",
            reply: {
              agentId: schedule.target.type === "agent" ? schedule.target.agentId : "",
              turnId: "heartbeat-turn-two",
              startedAt: at,
            },
            hop: 1,
          });
          await log.append({
            id: "manual-input",
            at: "2026-10-14T00:02:00.000Z",
            sender: { kind: "user" },
            text: "A later manual question",
            hop: 0,
          });
          await log.append({
            id: "manual-response",
            at: "2026-10-14T00:02:07.000Z",
            sender: { kind: "bot", botId: bot.id },
            text: "Manual response has no heartbeat metadata.",
            inReplyTo: "manual-input",
            reply: {
              agentId: "77777777-7777-4777-8777-777777777777",
              turnId: "manual-turn",
              startedAt: "2026-10-14T00:02:00.000Z",
            },
            hop: 1,
          });
          await log.append({
            id: "silent-response",
            at: "2026-10-14T00:03:00.000Z",
            sender: { kind: "bot", botId: bot.id },
            text: "PASS",
            inReplyTo: "scheduled-input",
            hop: 1,
          });
          await log.flush();
          await page.goto(`/h/${getServerId()}/chat/${chatId}`);
          const response = page.getByText("Heartbeat response belongs to run two.", {
            exact: true,
          });
          await expect(response).toBeVisible();
          await page.mouse.move(0, 0);
          await page.screenshot({ path: testInfo.outputPath("desktop-hidden.png") });
          if (await page.getByTestId("heartbeat-run-marker").count()) {
            await page.getByTestId("heartbeat-run-marker").scrollIntoViewIfNeeded();
            await page.screenshot({ path: testInfo.outputPath("baseline-separator.png") });
            await writeFile(
              testInfo.outputPath("baseline-frames.json"),
              JSON.stringify(frames, null, 2),
            );
          }
          const counter = page.getByTestId(`heartbeat-run-footer-${saved.scheduleId}`);
          await expect(page.getByTestId("heartbeat-run-marker")).toHaveCount(0);
          await expect(counter).toHaveCount(1);
          await expect(counter).toHaveText("2/1095");
          if (phone) {
            await expect(counter).toHaveCSS("opacity", "1");
            await page.screenshot({ path: testInfo.outputPath("phone-web-visible.png") });
            await counter.tap();
            await expect(page.getByTestId("schedule-detail-name")).toHaveValue(schedule.name!);
            await settledSheet(page);
            await page.screenshot({ path: testInfo.outputPath("phone-web-tap-exact-detail.png") });
          } else {
            await expect(counter).toHaveCSS("opacity", "0");
            await response.hover();
            await expect(counter).toHaveCSS("opacity", "1");
            await page.screenshot({ path: testInfo.outputPath("desktop-revealed.png") });
            await counter.hover();
            await expect(page.getByText(saved.name!, { exact: true })).toBeVisible();
            await expect(page.getByRole("tooltip").filter({ hasText: saved.name! })).toHaveCSS(
              "opacity",
              "1",
            );
            await page.screenshot({ path: testInfo.outputPath("desktop-name-tooltip.png") });
            await counter.click();
            const sheet = page.getByTestId("schedule-detail-sheet");
            await expect(sheet).toBeVisible();
            await expect(page.getByTestId("schedule-detail-name")).toHaveValue(schedule.name!);
            await settledSheet(page);
            await page.screenshot({ path: testInfo.outputPath("desktop-exact-detail.png") });
            await page.keyboard.press("Escape");
            await expect(sheet).not.toBeVisible();
            await page.mouse.move(0, 0);
            // RN Web dispatches Pressable focus for keyboard modality, not pointer restoration.
            await page.keyboard.press("Tab");
            await counter.focus();
            await expect(counter).toHaveCSS("opacity", "1");
            await page.screenshot({ path: testInfo.outputPath("desktop-keyboard-focus.png") });
            await counter.press("Enter");
            await expect(sheet).toBeVisible();
          }
          await writeFile(testInfo.outputPath("frames.json"), JSON.stringify(frames, null, 2));
          await writeFile(
            testInfo.outputPath("saved-transcript.json"),
            JSON.stringify(await client.fetchChatTranscript({ chatId }), null, 2),
          );
          await writeFile(
            testInfo.outputPath("inert-current-schedule.json"),
            JSON.stringify(schedule, null, 2),
          );
        } finally {
          if (chatId) await client.archiveChat({ chatId });
          await client.archiveBot({ botId: bot.id });
          await client.removeProject(bot.projectId);
          await client.close();
        }
      });
    }
  });

test("ordinary session uses the shared footer with exact historical turn counters", async ({
  page,
}, testInfo) => {
  const frames = await captureFrames(page);
  const fixture = await seedMockAgentWorkspace({
    repoPrefix: "footer-ordinary-",
    title: "Ordinary footer fixture",
  });
  try {
    await seedPausedSchedule(fixture.agentId);
    // Load fixture-only server implementation at runtime; its Node timer types must
    // stay out of the app's browser/native TypeScript compilation.
    const { AgentStorage } = require(
      path.resolve(__dirname, "../../../server/src/server/agent/agent-storage.ts"),
    ) as {
      AgentStorage: new (
        directory: string,
        logger: ReturnType<typeof pino>,
      ) => { getSessionDirectory(id: string): Promise<string> };
    };
    const { FileAgentTimelineStore } = require(
      path.resolve(
        __dirname,
        "../../../server/src/server/agent/session-storage/file-agent-timeline-store.ts",
      ),
    ) as {
      FileAgentTimelineStore: new (directory: (id: string) => Promise<string>) => {
        bulkInsert(id: string, rows: unknown[]): Promise<void>;
        flush(): Promise<void>;
      };
    };
    const registry = new AgentStorage(
      path.join(process.env.E2E_CLISBOT_HOME!, "agents"),
      pino({ level: "silent" }),
    );
    const store = new FileAgentTimelineStore((agentId) => registry.getSessionDirectory(agentId));
    const notice = formatHeartbeatRunNotice({
      title: saved.name!,
      run: saved.run,
      maxRuns: saved.maxRuns!,
    });
    await store.bulkInsert(fixture.agentId, [
      {
        seq: 1,
        timestamp: at,
        turnId: "ordinary-heartbeat",
        item: { type: "notification", level: "info", message: notice, heartbeatRun: saved },
      },
      {
        seq: 2,
        timestamp: "2026-10-14T00:01:51.000Z",
        turnId: "ordinary-heartbeat",
        item: { type: "assistant_message", text: "Ordinary heartbeat response." },
      },
      {
        seq: 3,
        timestamp: "2026-10-14T00:02:00.000Z",
        turnId: "ordinary-manual",
        item: { type: "user_message", text: "A manual follow-up" },
      },
      {
        seq: 4,
        timestamp: "2026-10-14T00:02:07.000Z",
        turnId: "ordinary-manual",
        item: { type: "assistant_message", text: "Ordinary manual response." },
      },
    ]);
    await store.flush();
    // Fixture writes happened outside the running daemon's store. Restart only this
    // supervised temp-home daemon so its authoritative reader starts from those records.
    expect([6767, 6768, 6868, 6869]).not.toContain(getE2EDaemonPort());
    const restarted = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "footer-history-reload",
    });
    try {
      const before = (await restarted.getDaemonStatus()).pid;
      await restarted.restartServer("Read inert footer history fixtures in the isolated daemon");
      await expect
        .poll(
          async () => {
            try {
              return (await restarted.getDaemonStatus()).pid;
            } catch {
              return before;
            }
          },
          { timeout: 60_000 },
        )
        .not.toBe(before);
    } finally {
      await restarted.close();
    }
    await openAgentRoute(page, fixture);
    await expect(page.getByText("Ordinary heartbeat response.", { exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath("ordinary-desktop-hidden.png") });
    const counter = page.getByTestId(`heartbeat-run-footer-${saved.scheduleId}`);
    await expect(page.getByTestId("heartbeat-run-marker")).toHaveCount(0);
    await expect(counter).toHaveCount(1);
    await expect(counter).toHaveText("2/1095");
    await expect(counter).toHaveCSS("opacity", "0");
    await counter.locator("..").hover();
    await expect(counter).toHaveCSS("opacity", "1");
    await page.screenshot({ path: testInfo.outputPath("ordinary-desktop-revealed.png") });
    await counter.click();
    await expect(page.getByTestId("schedule-detail-name")).toHaveValue("Current renamed heartbeat");
    await page.screenshot({ path: testInfo.outputPath("ordinary-exact-detail.png") });
    await writeFile(testInfo.outputPath("frames.json"), JSON.stringify(frames, null, 2));
  } finally {
    await fixture.cleanup();
  }
});

test.describe("historical phone-web", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("unlimited untitled/deleted and unknown legacy totals stay truthful", async ({
    page,
  }, testInfo) => {
    const frames = await captureFrames(page);
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "footer-historical" });
    const created = await client.createBot({
      name: "Historical footer fixture",
      launch: { provider: "mock", model: "e2e-fast-stream", modeId: "load-test" },
    });
    if (!created.bot) throw new Error(created.error ?? "Bot fixture failed");
    const bot = created.bot;
    let chatId: string | undefined;
    try {
      const result = await client.createChat({ kind: "direct", botIds: [bot.id] });
      if (!result.chat) throw new Error(result.error ?? "Chat fixture failed");
      chatId = result.chat.id;
      const log = new TranscriptLog(path.join(process.env.E2E_CLISBOT_HOME!, "chats", chatId));
      const cases = [
        {
          id: "deleted",
          run: { scheduleId: "deleted", run: 4, maxRuns: null, name: null },
          label: "Heartbeat · Old prompt fallback · run 4",
          text: "Unlimited untitled run.",
        },
        {
          id: "legacy",
          run: { scheduleId: "legacy", run: 7 },
          label: "Heartbeat · Historical prompt fallback · run 7 of 20",
          text: "Legacy saved finite total.",
        },
        {
          id: "unknown",
          run: { scheduleId: "unknown", run: 9 },
          label: "Unavailable original display snapshot",
          text: "Unknown historical total.",
        },
      ];
      for (const entry of cases) {
        await log.append({
          id: `${entry.id}-input`,
          at,
          sender: { kind: "user", displayName: entry.label },
          text: "Hidden input",
          scheduleRun: entry.run,
          hop: 0,
        });
        await log.append({
          id: `${entry.id}-reply`,
          at: "2026-10-14T00:00:07.000Z",
          sender: { kind: "bot", botId: bot.id },
          text: entry.text,
          inReplyTo: `${entry.id}-input`,
          hop: 1,
        });
      }
      await log.flush();
      await page.goto(`/h/${getServerId()}/chat/${chatId}`);
      const deleted = page.getByTestId("heartbeat-run-footer-deleted");
      await expect(deleted).toHaveText("4/∞");
      await expect(page.getByTestId("heartbeat-run-footer-legacy")).toHaveText("7/20");
      await expect(page.getByTestId("heartbeat-run-footer-unknown")).toHaveText("9/?");
      await expect(deleted).toHaveAttribute("aria-label", /Untitled heartbeat/);
      await page.screenshot({ path: testInfo.outputPath("historical-phone-web-counters.png") });
      await deleted.tap();
      await expect(page.getByText("Could not load this schedule.", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("schedule-detail-sheet")).toContainText("Error");
      await settledSheet(page);
      await page.screenshot({ path: testInfo.outputPath("deleted-exact-detail-load-failure.png") });
      await writeFile(testInfo.outputPath("frames.json"), JSON.stringify(frames, null, 2));
      await writeFile(
        testInfo.outputPath("saved-transcript.json"),
        JSON.stringify(await client.fetchChatTranscript({ chatId }), null, 2),
      );
    } finally {
      await writeFile(testInfo.outputPath("frames.json"), JSON.stringify(frames, null, 2));
      if (chatId) await client.archiveChat({ chatId });
      await client.archiveBot({ botId: bot.id });
      await client.removeProject(bot.projectId);
      await client.close();
    }
  });
});
