import type { Page, WebSocketRoute } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expectComposerVisible, startRunningMockAgent } from "../support/helpers/composer";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { getServerId } from "../support/helpers/server-id";

interface SendRequest {
  requestId: string;
  agentId: string;
  messageId: string;
  text: string;
}

type SendPolicy = "forward" | "refuse" | "drop-answer" | "hold";

/**
 * Sits between the app and the daemon. Every send request is recorded; the policy decides what
 * the app hears back: the daemon's answer, a refusal, or nothing at all.
 */
async function routeSends(page: Page, latencyMs = 0) {
  const sends: SendRequest[] = [];
  const state = { policy: "forward" as SendPolicy };
  await page.routeWebSocket(daemonWsRoutePattern(), (socket: WebSocketRoute) => {
    const server = socket.connectToServer();
    const dropAnswers = new Set<string>();
    socket.onMessage((payload) => {
      const request = readSend(payload);
      if (request) {
        sends.push(request);
        if (state.policy === "hold") return;
        if (state.policy === "refuse") {
          socket.send(refusal(request));
          return;
        }
        if (state.policy === "drop-answer") dropAnswers.add(request.requestId);
      }
      setTimeout(() => server.send(payload), latencyMs / 2);
    });
    server.onMessage((payload) => {
      const answer = readAnswerRequestId(payload);
      if (answer && dropAnswers.has(answer)) return;
      setTimeout(() => socket.send(payload), latencyMs / 2);
    });
  });
  return { sends, state };
}

function unwrap(payload: string | Buffer): Record<string, unknown> | null {
  if (typeof payload !== "string") return null;
  try {
    const envelope = JSON.parse(payload) as { type?: string; message?: Record<string, unknown> };
    return envelope.type === "session" ? (envelope.message ?? null) : envelope;
  } catch {
    return null;
  }
}

function readSend(payload: string | Buffer): SendRequest | null {
  const message = unwrap(payload);
  return message?.type === "send_agent_message_request"
    ? (message as unknown as SendRequest)
    : null;
}

function readAnswerRequestId(payload: string | Buffer): string | null {
  const message = unwrap(payload) as { type?: string; payload?: { requestId?: string } } | null;
  return message?.type === "send_agent_message_response"
    ? (message.payload?.requestId ?? null)
    : null;
}

function refusal(request: SendRequest): string {
  return JSON.stringify({
    type: "session",
    message: {
      type: "send_agent_message_response",
      payload: {
        requestId: request.requestId,
        agentId: request.agentId,
        accepted: false,
        error: "Refused for this test",
      },
    },
  });
}

function composer(page: Page) {
  return page.getByRole("textbox", { name: "Message agent..." }).filter({ visible: true }).first();
}

function userRows(page: Page, text: string) {
  return page.getByTestId("user-message").filter({ hasText: text });
}

/** Presses Enter and reads the first painted frame: is the row there, is the composer empty? */
async function sendAndReadFirstFrame(page: Page, text: string, input = composer(page)) {
  await input.fill(text);
  await input.evaluate((element, sent) => {
    const read = () => ({
      row: Array.from(document.querySelectorAll('[data-testid="user-message"]')).some((row) =>
        row.textContent?.includes(sent),
      ),
      cleared: (element as HTMLTextAreaElement).value === "",
    });
    const state = window as unknown as { __instantSendFrame: unknown };
    state.__instantSendFrame = null;
    const onKey = () =>
      requestAnimationFrame(() => {
        state.__instantSendFrame = read();
      });
    element.addEventListener("keydown", onKey, { once: true });
  }, text);
  await input.press("Enter");
  let frame: unknown = null;
  await expect
    .poll(async () => {
      frame = await page.evaluate(
        () => (window as unknown as { __instantSendFrame: unknown }).__instantSendFrame,
      );
      return frame;
    })
    .not.toBeNull();
  return frame as { row: boolean; cleared: boolean };
}

async function openIdleAgent(page: Page, prefix: string) {
  const agent = await seedMockAgentWorkspace({ repoPrefix: prefix, title: "Instant send" });
  await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
  await expectComposerVisible(page);
  await expectAgentIdle(page);
  return agent;
}

test.describe("Instant send", () => {
  test("shows the message and clears the composer in the press frame over a slow link", async ({
    page,
  }) => {
    await routeSends(page, 400);
    const agent = await openIdleAgent(page, "instant-frame-");
    try {
      const first = await sendAndReadFirstFrame(page, "Instant one");
      expect(first).toEqual({ row: true, cleared: true });
      // The composer takes the next message before the Host answers the first.
      const second = await sendAndReadFirstFrame(page, "Instant two");
      expect(second).toEqual({ row: true, cleared: true });
      await expect(userRows(page, "Instant two")).toHaveAttribute("aria-busy", "false", {
        timeout: 30_000,
      });
    } finally {
      await agent.cleanup();
    }
  });

  test("keeps a refused message in place with Retry, and the retry reuses its id", async ({
    page,
  }) => {
    const route = await routeSends(page);
    const agent = await openIdleAgent(page, "instant-retry-");
    try {
      route.state.policy = "refuse";
      await sendAndReadFirstFrame(page, "Refused once");
      const row = userRows(page, "Refused once");
      await expect(row.getByTestId("message-delivery-failed")).toContainText(
        "Not sent: Refused for this test",
      );
      await expect(composer(page)).toHaveValue("");

      route.state.policy = "forward";
      await row.getByTestId("message-delivery-retry").click();
      await expect(row.getByTestId("message-delivery-failed")).toHaveCount(0, { timeout: 30_000 });
      await expect(userRows(page, "Refused once")).toHaveCount(1);
      const ids = route.sends.filter((send) => send.text === "Refused once");
      expect(ids).toHaveLength(2);
      expect(ids[1]?.messageId).toBe(ids[0]?.messageId);
    } finally {
      await agent.cleanup();
    }
  });

  test("deletes a failed message", async ({ page }) => {
    const route = await routeSends(page);
    const agent = await openIdleAgent(page, "instant-delete-");
    try {
      route.state.policy = "refuse";
      await sendAndReadFirstFrame(page, "Delete me");
      const row = userRows(page, "Delete me");
      await row.getByTestId("message-delivery-delete").click();
      await expect(userRows(page, "Delete me")).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });

  test("keeps a pending message across a reload and sends it once", async ({ page }) => {
    const route = await routeSends(page);
    const agent = await openIdleAgent(page, "instant-restart-");
    try {
      // The Host gets the message but its answer is lost, then the app restarts.
      route.state.policy = "drop-answer";
      await sendAndReadFirstFrame(page, "Survive the restart");
      await expect.poll(() => route.sends.length).toBe(1);
      route.state.policy = "forward";
      await page.reload();
      await expectComposerVisible(page);

      await expect(userRows(page, "Survive the restart")).toHaveCount(1, { timeout: 30_000 });
      await expect.poll(() => route.sends.length, { timeout: 30_000 }).toBe(2);
      expect(route.sends[1]?.messageId).toBe(route.sends[0]?.messageId);
      await expect(userRows(page, "Survive the restart")).toHaveAttribute("aria-busy", "false", {
        timeout: 30_000,
      });
      const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "instant-restart" });
      const timeline = await client.fetchAgentTimeline(agent.agentId, { limit: 0 });
      await client.close();
      const prompts = timeline.entries.filter(
        (entry) => entry.item.type === "user_message" && entry.item.text === "Survive the restart",
      );
      expect(prompts).toHaveLength(1);
    } finally {
      await agent.cleanup();
    }
  });

  test("steers a running agent with the row in the press frame", async ({ page }) => {
    const running = await startRunningMockAgent(page, {
      prefix: "instant-steer-",
      model: "one-minute-stream",
      prompt: "Keep this turn running.",
    });
    try {
      const frame = await sendAndReadFirstFrame(page, "Steer while running");
      expect(frame).toEqual({ row: true, cleared: true });
      await expect(userRows(page, "Steer while running")).toHaveAttribute("aria-busy", "false", {
        timeout: 30_000,
      });
    } finally {
      await running.cleanup();
    }
  });

  test("shows a Bot chat message in the press frame", async ({ page }) => {
    await routeSends(page, 400);
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "instant-bot" });
    const created = await client.createBot({
      name: "Instant Bot",
      launch: { provider: "mock", model: "e2e-fast-stream", modeId: "load-test" },
    });
    const bot = created.bot!;
    try {
      const chat = (await client.createChat({ botIds: [bot.id] })).chat!;
      await page.goto(`/h/${getServerId()}/chat/${chat.id}`);
      const input = page.getByTestId("chat-composer").getByRole("textbox");
      await expect(input).toBeEditable({ timeout: 30_000 });
      const frame = await sendAndReadFirstFrame(page, "Bot instant", input);
      expect(frame).toEqual({ row: true, cleared: true });
      await expect(page.getByTestId("user-message").filter({ hasText: "Bot instant" })).toHaveCount(
        1,
      );
    } finally {
      await client.archiveBot({ botId: bot.id });
      await client.removeProject(bot.projectId);
      await client.close();
    }
  });
});
