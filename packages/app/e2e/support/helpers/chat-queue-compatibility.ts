import { writeFile } from "node:fs/promises";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { test, expect, disabledQueueProviders } from "./queue-fixture";
import { daemonWsRoutePattern } from "./daemon-port";
import { connectDaemonClient } from "./daemon-client-loader";
import { longPressSend } from "./queue-send-gesture";
import { attachFileFromMenu, attachComposerTestImage } from "./composer";

export function registerChatQueueCompatibility() {
  test.use({
    hasTouch: true,
    e2eDaemonConfig: {
      version: 1,
      features: { hostInputQueue: false },
      agents: { providers: disabledQueueProviders },
    },
  });
  for (const scenario of [
    { kind: "direct", capability: "absent", preference: "steer", trigger: "shortcut" },
    { kind: "direct", capability: "off", preference: "queue", trigger: "tap" },
    { kind: "group", capability: "off", preference: "steer", trigger: "longpress" },
    { kind: "group", capability: "absent", preference: "queue", trigger: "manual" },
  ] as const) {
    test(`${scenario.capability} ${scenario.kind} ${scenario.preference}: client Queue ${scenario.trigger} → Chat ACK/reply`, async ({
      page,
    }, info) => {
      test.setTimeout(120_000);
      const requests: Array<Record<string, unknown>> = [];
      const responses: Array<Record<string, unknown>> = [];
      await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
        const server = browser.connectToServer();
        browser.onMessage((raw) => {
          if (typeof raw === "string" && raw.startsWith("{")) {
            const envelope = JSON.parse(raw);
            requests.push(envelope.type === "session" ? envelope.message : envelope);
          }
          server.send(raw);
        });
        server.onMessage((raw) => {
          if (typeof raw !== "string" || !raw.startsWith("{")) {
            browser.send(raw);
            return;
          }
          const envelope = JSON.parse(raw);
          const message = envelope.type === "session" ? envelope.message : envelope;
          if (message.type === "chat.message.send.response") responses.push(message.payload);
          if (message.payload?.status === "server_info" && scenario.capability === "absent")
            delete message.payload.features.hostInputQueue;
          if (scenario.kind === "group" && scenario.capability === "absent") {
            const strip = (value: unknown): void => {
              if (!value || typeof value !== "object") return;
              if ("participants" in value)
                delete (value as { discussionActive?: boolean }).discussionActive;
              for (const nested of Object.values(value)) strip(nested);
            };
            strip(message);
          }
          browser.send(JSON.stringify(envelope));
        });
      });
      await page.addInitScript((sendBehavior) => {
        const settings = JSON.parse(localStorage.getItem("@clisbot:app-settings") ?? "{}");
        localStorage.setItem(
          "@clisbot:app-settings",
          JSON.stringify({ ...settings, sendBehavior }),
        );
      }, scenario.preference);
      const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "full-chat-queue" });
      const bot = (
        await client.createBot({
          name: "Client queue fixture",
          launch: {
            provider: "mock",
            model: "one-minute-stream",
            modeId: "load-test",
          },
        })
      ).bot!;
      const chat = (
        await client.createChat({
          botIds: [bot.id],
          kind: scenario.kind,
          rules: { rounds: { max: 1 }, interaction: { whenBusy: "steer" } },
        })
      ).chat!;
      try {
        const { getServerId } = await import("./server-id");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/h/${getServerId()}/chat/${chat.id}`);
        const scope = page.getByTestId("chat-composer");
        const input = scope.getByRole("textbox").last();
        await expect(input).toBeEditable();
        await input.fill("1+1");
        await scope.getByTestId("composer-send-button").tap();
        await expect(page.getByTestId("turn-working-indicator").first()).toBeVisible();
        await attachFileFromMenu(page, {
          name: "queue.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("client Chat retained bytes"),
        });
        await attachComposerTestImage(page);
        await input.fill("2+2");
        const countBefore = requests.filter((r) => r.type === "chat.message.send.request").length;
        await longPressSend(page, scope);
        expect(requests.filter((r) => r.type === "chat.message.send.request")).toHaveLength(
          countBefore,
        );
        await page.touchscreen.tap(12, 12);
        await expect(input).toHaveValue("2+2");
        await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
        if (scenario.trigger === "shortcut") {
          await page.setViewportSize({ width: 1100, height: 900 });
          await input.press("Control+Enter");
        } else if (scenario.trigger === "tap")
          await scope.getByTestId("composer-send-button").tap();
        else if (scenario.trigger === "manual")
          await scope.getByTestId("composer-send-button").tap();
        else {
          await longPressSend(page, scope);
          await page.getByTestId("composer-send-once-queue").tap();
        }
        await expect(input).toHaveValue("");
        const row = page.locator('[data-testid^="host-queue-"]').filter({ hasText: "2+2" });
        await expect(row).toBeVisible();
        await expect(row).toContainText("Attachments (2)");
        const itemId = (await row.getAttribute("data-testid"))!.slice("host-queue-".length);
        expect(requests.filter((r) => r.type === "chat.message.send.request")).toHaveLength(
          countBefore,
        );
        if (scenario.trigger === "manual") {
          await input.fill("Delete this local item");
          await scope.getByTestId("composer-send-button").tap();
          const disposable = page
            .locator('[data-testid^="host-queue-"]')
            .filter({ hasText: "Delete this local item" });
          await expect(disposable).toBeVisible();
          await disposable.getByRole("button", { name: "Delete", exact: true }).tap();
          await expect(disposable).toHaveCount(0);
          await expect(page.getByTestId(`host-queue-${itemId}`)).toBeVisible();
        }
        const current = (await client.listChats()).chats.find((c) => c.id === chat.id)!;
        const agentId = current.participants[0].agentId!;
        await client.setAgentModel(agentId, "ten-second-stream");
        await client.cancelAgent(agentId);
        if (scenario.trigger === "manual") {
          await expect(
            scope.getByText(/This Host cannot report when the group ends/),
          ).toBeVisible();
          await expect(
            row.getByRole("button", { name: "Steer this send", exact: true }),
          ).toHaveCount(0);
          await row.getByRole("button", { name: "Edit", exact: true }).tap();
          await expect(input).toHaveValue("2+2");
          await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
          await expect(page.getByTestId("composer-image-attachment-pill")).toBeVisible();
          await input.fill("2+2 edited");
          await scope.getByTestId("composer-send-button").tap();
          const retained = page.getByTestId(`host-queue-${itemId}`);
          await expect(retained).toContainText("2+2 edited");
          expect(requests.filter((r) => r.type === "chat.message.send.request")).toHaveLength(
            countBefore,
          );
          await page.screenshot({
            path: info.outputPath("old-group-client-queue-manual-ready.png"),
          });
          await retained.getByRole("button", { name: "Send message", exact: true }).tap();
        }
        await expect
          .poll(() => responses.some((r) => r.messageId === itemId && !r.error), {
            timeout: 30_000,
          })
          .toBe(true);
        await expect(row).toHaveCount(0);
        await expect
          .poll(
            async () =>
              (await client.fetchChatTranscript({ chatId: chat.id })).lines.some(
                (line) => line.inReplyTo === itemId && line.sender.kind === "bot",
              ),
            { timeout: 30_000 },
          )
          .toBe(true);
        const transcript = await client.fetchChatTranscript({ chatId: chat.id });
        const accepted = transcript.lines.find((line) => line.id === itemId)!;
        expect(accepted.text).toBe(scenario.trigger === "manual" ? "2+2 edited" : "2+2");
        expect(accepted.images?.length).toBe(1);
        expect(accepted.images?.[0].data).toBe(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        );
        expect(accepted.attachments?.length).toBe(1);
        const file = accepted.attachments?.[0];
        if (file?.type !== "uploaded_file") throw new Error("Expected retained Chat file");
        const bytes = await client.readFile(
          file.path.slice(0, file.path.lastIndexOf("/")),
          file.path,
        );
        expect(Buffer.from(bytes.bytes).toString("utf8")).toBe("client Chat retained bytes");
        await writeFile(
          info.outputPath("attachment-byte-proof.json"),
          JSON.stringify(
            {
              messageId: itemId,
              path: file.path,
              bytes: bytes.bytes.length,
              expectedMatch: true,
              scope: "authorized synthetic fixture Chat readFile",
            },
            null,
            2,
          ),
        );

        expect(
          requests.filter((r) => r.type === "chat.message.send.request" && r.messageId === itemId),
        ).toHaveLength(1);
        expect(
          requests.filter(
            (r) =>
              String(r.type).includes("queue.execute") || r.type === "send_agent_message_request",
          ),
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => JSON.parse(localStorage.getItem("@clisbot:app-settings")!).sendBehavior,
          ),
        ).toBe(scenario.preference);
        await page.screenshot({ path: info.outputPath("client-chat-queue-delivered.png") });
        await writeFile(
          info.outputPath("client-chat-queue-proof.json"),
          JSON.stringify({ scenario, itemId, requests, responses, transcript }, null, 2),
        );
      } catch (error) {
        await page.screenshot({ path: info.outputPath("failure-before-cleanup.png") });
        await writeFile(
          info.outputPath("failure-wire.json"),
          JSON.stringify({ requests, responses }, null, 2),
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
}
