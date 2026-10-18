import { registerSessionQueueCompatibility } from "../support/helpers/queue-compatibility";
import { writeFile } from "node:fs/promises";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { test, expect, disabledQueueProviders } from "../support/helpers/queue-fixture";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { longPressSend } from "../support/helpers/queue-send-gesture";
import { attachFileFromMenu } from "../support/helpers/composer";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";

test.use({
  hasTouch: true,
  e2eDaemonConfig: {
    version: 1,
    features: { hostInputQueue: false },
    agents: { providers: disabledQueueProviders },
  },
});

for (const kind of ["direct", "group"] as const) {
  test(`old Host ${kind}: saved Queue remains Send, hidden override and Chat reply stream`, async ({
    page,
  }, info) => {
    const requests: Array<Record<string, unknown>> = [];
    const acknowledgements: Array<{ error?: string | null }> = [];
    await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
      const server = browser.connectToServer();
      browser.onMessage((raw) => {
        if (typeof raw !== "string" || !raw.startsWith("{")) {
          server.send(raw);
          return;
        }
        const envelope = JSON.parse(String(raw));
        const request = envelope.type === "session" ? envelope.message : envelope;
        requests.push(request);
        server.send(raw);
      });
      server.onMessage((raw) => {
        if (typeof raw !== "string" || !raw.startsWith("{")) {
          browser.send(raw);
          return;
        }
        const envelope = JSON.parse(String(raw));
        const message = envelope.type === "session" ? envelope.message : envelope;
        if (message.type === "chat.message.send.response") acknowledgements.push(message.payload);
        if (message.payload?.status === "server_info")
          delete message.payload.features.hostInputQueue;
        browser.send(JSON.stringify(envelope));
      });
    });
    await page.addInitScript(() => {
      const settings = JSON.parse(localStorage.getItem("@clisbot:app-settings") ?? "{}");
      localStorage.setItem(
        "@clisbot:app-settings",
        JSON.stringify({ ...settings, sendBehavior: "queue" }),
      );
    });
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "legacy-chat" });
    const bot = (
      await client.createBot({
        name: "Legacy Chat Bot",
        launch: { provider: "mock", model: "one-minute-stream", modeId: "load-test" },
      })
    ).bot!;
    const chat = (
      await client.createChat({
        botIds: [bot.id],
        kind,
        rules: { rounds: { max: 1 }, interaction: { whenBusy: "steer" } },
      })
    ).chat!;
    try {
      const { getServerId } = await import("../support/helpers/server-id");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/h/${getServerId()}/chat/${chat.id}`);
      const scope = page.getByTestId("chat-composer");
      const input = scope.getByRole("textbox").last();
      await expect(input).toBeEditable();
      await input.fill("Start old Chat");
      await scope.getByTestId("composer-send-button").tap();
      await expect(page.getByTestId("turn-working-indicator").first()).toBeVisible();
      await attachFileFromMenu(page, {
        name: "chat.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Chat file retained"),
      });
      await input.fill("Send via Chat rules");
      await expect(scope.getByTestId("composer-send-button")).toHaveAttribute(
        "aria-label",
        "Send message",
      );
      await longPressSend(page, scope, "steer");
      await expect(page.getByTestId("composer-send-once-queue")).toHaveCount(0);
      await page.touchscreen.tap(12, 12);
      await expect(input).toHaveValue("Send via Chat rules");
      await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
      await page.setViewportSize({ width: 1100, height: 900 });
      await input.press("Control+Enter");
      await expect(
        page.getByText("Update this Host to use its durable queue", { exact: true }),
      ).toBeVisible();
      await expect(input).toHaveValue("Send via Chat rules");
      await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await scope.getByTestId("composer-send-button").tap();
      await expect(input).toHaveValue("");
      await expect(page.getByText("Send via Chat rules", { exact: true }).first()).toBeVisible();
      expect(requests.filter((request) => String(request.type).includes("queue.execute"))).toEqual(
        [],
      );
      await expect.poll(() => acknowledgements.length).toBe(2);
      expect(acknowledgements.every((response) => !response.error)).toBe(true);
      const chatSends = requests.filter((request) =>
        String(request.type).includes("chat.message.send"),
      );
      expect(chatSends.length).toBeGreaterThanOrEqual(2);
      for (const send of chatSends) {
        expect(send).not.toHaveProperty("activeTurnBehavior");
        expect(send).not.toHaveProperty("steerTarget");
      }
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("@clisbot:app-settings")!).sendBehavior,
        ),
      ).toBe("queue");
      await page.screenshot({ path: info.outputPath("legacy-chat-send.png") });
      await writeFile(info.outputPath("legacy-chat-wire.json"), JSON.stringify(chatSends, null, 2));
    } catch (error) {
      await page.screenshot({ path: info.outputPath("chat-failure-before-cleanup.png") });
      await writeFile(
        info.outputPath("chat-failure-wire.json"),
        JSON.stringify({ requests, acknowledgements }, null, 2),
      );
      throw error;
    } finally {
      await client.archiveChat({ chatId: chat.id });
      await client.archiveBot({ botId: bot.id });
      await client.removeProject(bot.projectId);
      await client.close();
    }
  });
}

registerSessionQueueCompatibility("legacy");

test("old Host settled menu exposes only Steer before any Bot session exists", async ({
  page,
}, info) => {
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "old-chat-menu" });
  const bot = (
    await client.createBot({
      name: "Old Chat menu",
      launch: { provider: "mock", modeId: "load-test" },
    })
  ).bot!;
  const chat = (await client.createChat({ botIds: [bot.id], kind: "direct" })).chat!;
  try {
    const { getServerId } = await import("../support/helpers/server-id");
    const { waitForSettledPosition } = await import("../support/helpers/sheet-layout");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${getServerId()}/chat/${chat.id}`);
    const scope = page.getByTestId("chat-composer");
    const input = scope.getByRole("textbox").last();
    await expect(input).toBeEditable();
    await input.fill("Retain this legacy Chat draft");
    await longPressSend(page, scope, "steer");
    const action = page.getByTestId("composer-send-once-steer");
    await waitForSettledPosition(action);
    await expect(page.getByTestId("composer-send-once-queue")).toHaveCount(0);
    const box = (await action.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath("old-chat-steer-only-menu-settled.png") });
    await writeFile(
      info.outputPath("old-chat-menu-geometry.json"),
      JSON.stringify(
        { platform: "Chromium phone web", viewport: page.viewportSize(), box },
        null,
        2,
      ),
    );
    await page.touchscreen.tap(12, 12);
    await expect(input).toHaveValue("Retain this legacy Chat draft");
  } finally {
    await client.archiveChat({ chatId: chat.id });
    await client.archiveBot({ botId: bot.id });
    await client.removeProject(bot.projectId);
    await client.close();
  }
});
