import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
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
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "image-queue-",
    title: "Image queue",
    model: "one-minute-stream",
  });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "image-queue-fixture" });
  try {
    await openAgentRoute(page, workspace);
    const input = page.getByTestId("message-input-root").getByRole("textbox").last();
    await input.fill("Start fixture work");
    await page.getByTestId("composer-send-button").last().click();
    await expect(page.getByTestId("turn-working-indicator").first()).toBeVisible();
    for (const file of await imageFiles()) await attachImageFromMenu(page, file);
    await input.fill("Queue all three images");
    await input.press("Control+Enter");
    const row = page.locator('[data-testid^="host-queue-"]').first();
    await expect(row).toBeVisible();
    await expect(input).toHaveValue("");
    const queued = await client.executeAgentQueueCommand({
      agentId: workspace.agentId,
      command: { action: "fetch" },
    });
    expect(queued.queue!.items).toHaveLength(1);
    await page.screenshot({ path: info.outputPath("queue-prepared.png") });
    for (const file of await imageFiles()) await attachImageFromMenu(page, file);
    await input.fill("Steer with all three images");
    await page.getByTestId("composer-send-button").last().click();
    await expect(input).toHaveValue("");
    await expect(
      page.getByTestId("user-message").filter({ hasText: "Steer with all three images" }),
    ).toBeVisible();
    await expect(row).toBeVisible();
    await page.screenshot({ path: info.outputPath("steer-prepared.png") });
  } finally {
    await workspace.cleanup();
    await client.close();
  }
});
