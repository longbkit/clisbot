import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { Page } from "@playwright/test";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { getServerId } from "../support/helpers/server-id";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { TranscriptLog } from "../../../server/src/server/chats/transcript-log";

test.use({ e2eDaemonEnvironment: { CLISBOT_TAILSCALE_BIN: process.execPath } });

async function positions(page: Page) {
  return page.getByTestId("chat-list").evaluate((list) => ({
    viewport: list.getBoundingClientRect().toJSON(),
    scrollTop: list.scrollTop,
    scrollHeight: list.scrollHeight,
    messages: Array.from(
      list.querySelectorAll<HTMLElement>(
        '[data-testid="user-message"], [data-testid="assistant-message"], [data-testid="turn-working-indicator"]',
      ),
    )
      .map((row) => ({
        kind: row.dataset.testid,
        text: row.textContent?.slice(0, 130),
        y: row.getBoundingClientRect().y,
        height: row.getBoundingClientRect().height,
      }))
      .sort((a, b) => a.y - b.y),
  }));
}

test("DM: capture in-flight interleaving and settled positions on pinned accepted projection", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 960 });
  const frames: unknown[] = [];
  await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((payload) => server.send(payload));
    server.onMessage((payload) => {
      const envelope = JSON.parse(String(payload));
      const message = envelope.type === "session" ? envelope.message : envelope;
      if (
        [
          "agent_stream",
          "chat.updated",
          "chat.transcript.appended",
          "fetch_agent_timeline_response",
          "chat.message.send.response",
        ].includes(message.type)
      )
        frames.push(message);
      socket.send(payload);
    });
  });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "f03-running" });
  const result = await client.createBot({
    name: "F03 isolated DM",
    launch: { provider: "mock", model: "ten-second-stream", modeId: "load-test" },
  });
  expect(result.error).toBeNull();
  const bot = result.bot!;
  try {
    const created = await client.createChat({ botIds: [bot.id] });
    expect(created.error).toBeNull();
    const chatId = created.chat!.id;
    const log = new TranscriptLog(path.join(process.env.E2E_CLISBOT_HOME!, "chats", chatId));
    for (let i = 0; i < 30; i++)
      await log.append({
        id: `f03-history-${i}`,
        at: new Date(1700000000000 + i).toISOString(),
        sender: { kind: "user", id: "owner" },
        text: `F03 history ${i}`,
        hop: 0,
      });
    await page.goto(`/h/${getServerId()}/chat/${chatId}`);
    const composer = page.getByTestId("chat-composer").getByRole("textbox");
    await expect(composer).toBeEditable();
    await composer.fill("F03 start long running turn");
    await composer.press("Enter");
    await expect(page.getByTestId("turn-working-indicator")).toBeVisible();
    await expect.poll(() => page.getByTestId("assistant-message").count()).toBeGreaterThan(3);
    const before = await positions(page);
    await composer.fill("F03 interleaved input during running turn");
    await composer.press("Enter");
    await expect(
      page.getByTestId("user-message").filter({ hasText: "F03 interleaved" }),
    ).toBeAttached();
    await expect(page.getByTestId("turn-working-indicator")).toBeVisible();
    const chats = await client.listChats();
    const agentId = chats.chats.find((chat) => chat.id === chatId)!.participants[0]!.agentId!;
    const running = {
      positions: await positions(page),
      transcript: await client.fetchChatTranscript({ chatId, limit: 0 }),
      timeline: await client.fetchAgentTimeline(agentId, { limit: 0 }),
    };
    await info.attach("running-position", {
      body: JSON.stringify({ before, running, frames }, null, 2),
      contentType: "application/json",
    });
    await info.attach("running-screen", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await expect(page.getByTestId("turn-working-indicator")).toHaveCount(0, { timeout: 25_000 });
    const settled = {
      positions: await positions(page),
      transcript: await client.fetchChatTranscript({ chatId, limit: 0 }),
      timeline: await client.fetchAgentTimeline(agentId, { limit: 0 }),
    };
    await info.attach("settled-position", {
      body: JSON.stringify({ settled, frames }, null, 2),
      contentType: "application/json",
    });
    await info.attach("settled-screen", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    expect(running.transcript.lines.find((l) => l.text.includes("F03 interleaved"))!.seq).toBe(32);
    const inputY = running.positions.messages.find((row) =>
      row.text?.includes("F03 interleaved"),
    )!.y;
    const firstProgressY = running.positions.messages.find(
      (row) => row.kind === "assistant-message",
    )!.y;
    expect(
      firstProgressY,
      "already emitted progress must precede the canonical in-flight input",
    ).toBeLessThan(inputY);
  } finally {
    await client.archiveBot({ botId: bot.id });
    await client.removeProject(bot.projectId);
    await client.close();
  }
});

test("group: keeps the existing running floor and canonical settled order", async ({
  page,
}, info) => {
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "f03-group-control" });
  const result = await client.createBot({
    name: "F03 group control",
    launch: {
      provider: "mock",
      model: "e2e-fast-stream",
      modeId: "load-test",
      featureValues: {
        mockStreamingAssistantResponse: "F03_GROUP_PREFIX " + "group stream ".repeat(20),
        mockStreamingAssistantIntervalMs: 50,
      },
    },
  });
  expect(result.error).toBeNull();
  const bot = result.bot!;
  try {
    const created = await client.createChat({
      botIds: [bot.id],
      kind: "group",
      rules: { rounds: { max: 1 } },
    });
    expect(created.error).toBeNull();
    const chatId = created.chat!.id;
    await page.goto(`/h/${getServerId()}/chat/${chatId}`);
    const composer = page.getByTestId("chat-composer").getByRole("textbox");
    await expect(composer).toBeEditable();
    await composer.fill("F03 group accepted input");
    await composer.press("Enter");
    await expect(page.getByTestId("turn-working-indicator")).toHaveCount(1);
    await expect(page.getByTestId("assistant-message")).toContainText("F03_GROUP_PREFIX");
    const running = await positions(page);
    expect(running.messages.find((row) => row.kind === "user-message")!.y).toBeLessThan(
      running.messages.find((row) => row.kind === "assistant-message")!.y,
    );
    await expect
      .poll(async () => (await client.fetchChatTranscript({ chatId })).lines.length)
      .toBe(2);
    await expect(page.getByTestId("turn-working-indicator")).toHaveCount(0);
    await info.attach("group-running-settled", {
      body: JSON.stringify(
        {
          running,
          settled: await positions(page),
          transcript: await client.fetchChatTranscript({ chatId, limit: 0 }),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await client.archiveBot({ botId: bot.id });
    await client.removeProject(bot.projectId);
    await client.close();
  }
});
