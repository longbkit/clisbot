import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { SessionInboundMessage, SessionOutboundMessage } from "@clisbot/protocol/messages";
import { test, expect, disabledQueueProviders } from "../support/helpers/queue-fixture";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { attachImageFromMenu } from "../support/helpers/composer";

test.use({ e2eDaemonConfig: { version: 1, agents: { providers: disabledQueueProviders } } });

async function imageFiles() {
  const pixels = Buffer.alloc(1600 * 1000 * 3);
  let value = 1;
  for (let index = 0; index < pixels.length; index++) {
    value = (value * 1664525 + 1013904223) >>> 0;
    pixels[index] = value >>> 24;
  }
  const buffer = await sharp(pixels, { raw: { width: 1600, height: 1000, channels: 3 } })
    .png()
    .toBuffer();
  return [1, 2, 3].map((index) => ({ name: `photo-${index}.png`, mimeType: "image/png", buffer }));
}

for (const kind of ["session", "direct", "group"] as const) {
  test(`${kind}: three large images prepare and send once through the real daemon`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const sends: Array<{ type: string; images?: { data: string; mimeType: string }[] }> = [];
    await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
      const server = browser.connectToServer();
      browser.onMessage((raw) => {
        if (typeof raw === "string" && raw.startsWith("{")) {
          const envelope = JSON.parse(raw);
          const message = envelope.type === "session" ? envelope.message : envelope;
          if (["send_agent_message_request", "chat.message.send.request"].includes(message.type))
            sends.push(message);
        }
        server.send(raw);
      });
      server.onMessage((raw) => browser.send(raw));
    });
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "image-send-fixture",
    });
    const workspace =
      kind === "session"
        ? await seedMockAgentWorkspace({
            repoPrefix: "image-send-",
            title: "Image send",
            model: "e2e-fast-stream",
          })
        : null;
    const bot =
      kind !== "session"
        ? (
            await client.createBot({
              name: "Image send fixture",
              launch: { provider: "mock", model: "e2e-fast-stream", modeId: "load-test" },
            })
          ).bot!
        : null;
    const chat = bot
      ? (
          await client.createChat({
            botIds: [bot.id],
            kind: kind === "group" ? "group" : "direct",
            rules: { rounds: { max: 1 } },
          })
        ).chat!
      : null;
    try {
      if (workspace) await openAgentRoute(page, workspace);
      else await page.goto(`/h/${getServerId()}/chat/${chat!.id}`);
      const input = page.getByTestId("message-input-root").getByRole("textbox").last();
      await expect(input).toBeEditable();
      for (const file of await imageFiles()) await attachImageFromMenu(page, file);
      await expect(page.getByTestId("composer-image-attachment-pill")).toHaveCount(3);
      await input.fill("Review all three images together");
      await page.screenshot({ path: info.outputPath(`${kind}-ready.png`) });
      await page.getByTestId("composer-send-button").last().click();
      await expect(input).toHaveValue("");
      await expect(page.getByTestId("composer-image-attachment-pill")).toHaveCount(0);
      await expect.poll(() => sends.length).toBe(1);
      expect(sends[0].images).toHaveLength(3);
      const encodedBytes = sends[0].images!.reduce((sum, image) => sum + image.data.length, 0);
      expect(encodedBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      if (chat) {
        await expect
          .poll(
            async () =>
              (await client.fetchChatTranscript({ chatId: chat.id })).lines.some(
                (line) => line.sender.kind === "bot",
              ),
            { timeout: 30000 },
          )
          .toBe(true);
        const lines = (await client.fetchChatTranscript({ chatId: chat.id })).lines;
        expect(lines[0].images).toEqual(sends[0].images);
        expect(lines[0].text).toBe("Review all three images together");
      } else
        await expect(page.getByTestId("assistant-message").first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByText("Session file storage overloaded", { exact: false })).toHaveCount(
        0,
      );
      await page.screenshot({ path: info.outputPath(`${kind}-sent.png`) });
      await writeFile(
        info.outputPath("proof.json"),
        JSON.stringify(
          {
            kind,
            images: 3,
            encodedBytes,
            sends: sends.length,
            realDaemon: true,
            mockProvider: true,
          },
          null,
          2,
        ),
      );
    } finally {
      await workspace?.cleanup();
      if (chat) await client.archiveChat({ chatId: chat.id });
      if (bot) {
        await client.archiveBot({ botId: bot.id });
        await client.removeProject(bot.projectId);
      }
      await client.close();
    }
  });
}

test("failed image preparation keeps text and original attachments without sending", async ({
  page,
}, info) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "image-failure-",
    title: "Image failure",
    model: "e2e-fast-stream",
  });
  let sends = 0;
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((raw) => {
      if (typeof raw === "string" && raw.includes('"send_agent_message_request"')) sends++;
      server.send(raw);
    });
    server.onMessage((raw) => browser.send(raw));
  });
  try {
    await openAgentRoute(page, workspace);
    const input = page.getByTestId("message-input-root").getByRole("textbox").last();
    await expect(input).toBeEditable();
    await attachImageFromMenu(page, {
      name: "unreadable.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(2 * 1024 * 1024, 1),
    });
    await input.fill("Keep my text and original image");
    await page.getByTestId("composer-send-button").last().click();
    await expect(page.getByText("Could not prepare these images.", { exact: false })).toBeVisible();
    await expect(input).toHaveValue("Keep my text and original image");
    await expect(page.getByTestId("composer-image-attachment-pill")).toHaveCount(1);
    expect(sends).toBe(0);
    await page.screenshot({ path: info.outputPath("failure-draft-retained.png") });
  } finally {
    await workspace.cleanup();
  }
});

test("busy session prepares large image Queue and Steer submissions through the shared service", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.addInitScript(() =>
    localStorage.setItem("@clisbot:app-settings", JSON.stringify({ sendBehavior: "steer" })),
  );
  type QueueRequest = Extract<SessionInboundMessage, { type: "agent.queue.execute.request" }>;
  type SendRequest = Extract<SessionInboundMessage, { type: "send_agent_message_request" }>;
  type QueueResponse = Extract<SessionOutboundMessage, { type: "agent.queue.execute.response" }>;
  type SendResponse = Extract<SessionOutboundMessage, { type: "send_agent_message_response" }>;
  const enqueues: QueueRequest[] = [];
  const steers: SendRequest[] = [];
  let acceptQueue!: (response: QueueResponse) => void;
  let acceptSteer!: (response: SendResponse) => void;
  const queueAccepted = new Promise<QueueResponse>((resolve) => (acceptQueue = resolve));
  const steerAccepted = new Promise<SendResponse>((resolve) => (acceptSteer = resolve));
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((raw) => {
      if (typeof raw === "string" && raw.startsWith("{")) {
        const envelope = JSON.parse(raw);
        const message: SessionInboundMessage =
          envelope.type === "session" ? envelope.message : envelope;
        if (message.type === "agent.queue.execute.request" && message.command.action === "enqueue")
          enqueues.push(message);
        if (
          message.type === "send_agent_message_request" &&
          message.text === "Steer with all three images"
        )
          steers.push(message);
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      if (typeof raw === "string" && raw.startsWith("{")) {
        const envelope = JSON.parse(raw);
        const message: SessionOutboundMessage =
          envelope.type === "session" ? envelope.message : envelope;
        if (
          message.type === "agent.queue.execute.response" &&
          message.payload.requestId === enqueues[0]?.requestId
        )
          acceptQueue(message);
        if (
          message.type === "send_agent_message_response" &&
          message.payload.requestId === steers[0]?.requestId
        )
          acceptSteer(message);
      }
      browser.send(raw);
    });
  });
  const files = await imageFiles();
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "image-queue-",
    title: "Image queue",
    // Keep the turn busy throughout the existing 120 s image-preparation budget.
    // Cleanup cancels it; the test never waits for this synthetic stream to finish.
    model: "thirty-minute-stream",
  });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "image-queue-fixture" });
  try {
    await openAgentRoute(page, workspace);
    const input = page.getByTestId("message-input-root").getByRole("textbox").last();
    await input.fill("Start fixture work");
    await page.getByTestId("composer-send-button").last().click();
    await expect(page.getByTestId("turn-working-indicator").first()).toBeVisible();
    for (const file of files) await attachImageFromMenu(page, file);
    await expect(page.getByTestId("composer-image-attachment-pill")).toHaveCount(3);
    await input.fill("Queue all three images");
    const queueStartedAt = Date.now();
    await input.press("Control+Enter");
    // Large-image normalization is asynchronous and precedes the Host request.
    // Wait for that exact accepted request within the scenario budget, then
    // keep the normal UI deadline for publishing its durable queue row.
    expect((await queueAccepted).payload.error).toBeNull();
    const queuePreparationAndAcceptanceMs = Date.now() - queueStartedAt;
    expect(enqueues).toHaveLength(1);
    const command = enqueues[0].command;
    expect(command.action).toBe("enqueue");
    if (command.action !== "enqueue") throw new Error("Expected the image enqueue request");
    expect(command.images).toHaveLength(3);
    const queueBytes = command.images!.reduce((sum, image) => sum + image.data.length, 0);
    expect(queueBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    const row = page.getByTestId(`host-queue-${command.id}`);
    await expect(row).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("composer-image-attachment-pill")).toHaveCount(0);
    const queued = await client.executeAgentQueueCommand({
      agentId: workspace.agentId,
      command: { action: "fetch" },
    });
    expect(queued.error).toBeNull();
    expect(queued.queue!.items).toHaveLength(1);
    expect(queued.queue!.items[0]).toMatchObject({
      id: command.id,
      text: "Queue all three images",
      images: command.images,
    });
    await page.screenshot({ path: info.outputPath("queue-prepared.png") });
    for (const file of files) await attachImageFromMenu(page, file);
    await expect(page.getByTestId("composer-image-attachment-pill")).toHaveCount(3);
    await expect(page.getByTestId("turn-working-indicator").first()).toBeVisible();
    await input.fill("Steer with all three images");
    const steerStartedAt = Date.now();
    await page.getByTestId("composer-send-button").last().click();
    expect((await steerAccepted).payload.accepted).toBe(true);
    const steerPreparationAndAcceptanceMs = Date.now() - steerStartedAt;
    expect(steers).toHaveLength(1);
    expect(steers[0].activeTurnBehavior).toBe("steer");
    expect(steers[0].expectedTurnId).toEqual(expect.any(String));
    expect(steers[0].images).toHaveLength(3);
    const steerBytes = steers[0].images!.reduce((sum, image) => sum + image.data.length, 0);
    expect(steerBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("composer-image-attachment-pill")).toHaveCount(0);
    await expect(
      page.getByTestId("user-message").filter({ hasText: "Steer with all three images" }),
    ).toBeVisible();
    await expect(row).toBeVisible();
    const afterSteer = await client.executeAgentQueueCommand({
      agentId: workspace.agentId,
      command: { action: "fetch" },
    });
    expect(afterSteer.error).toBeNull();
    expect(afterSteer.queue!.items).toEqual(queued.queue!.items);
    expect(enqueues).toHaveLength(1);
    await writeFile(
      info.outputPath("busy-image-proof.json"),
      JSON.stringify(
        {
          agentId: workspace.agentId,
          queueId: command.id,
          queueBytes,
          steerBytes,
          queuePreparationAndAcceptanceMs,
          steerPreparationAndAcceptanceMs,
          enqueues: enqueues.length,
          steers: steers.length,
          realDaemon: true,
          mockProvider: true,
        },
        null,
        2,
      ),
    );
    await page.screenshot({ path: info.outputPath("steer-prepared.png") });
  } finally {
    await workspace.cleanup();
    await client.close();
  }
});
