import { writeFile } from "node:fs/promises";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { test, expect, disabledQueueProviders } from "../support/helpers/queue-fixture";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { attachFileFromMenu, attachComposerTestImage } from "../support/helpers/composer";
test.use({
  hasTouch: true,
  e2eDaemonConfig: { version: 1, agents: { providers: disabledQueueProviders } },
});
for (const manual of [false, true]) {
  test(`${manual ? "manual" : "default"} compact queue phone and desktop whole frames`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    if (manual)
      await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
        const server = browser.connectToServer();
        browser.onMessage((raw) => server.send(raw));
        server.onMessage((raw) => {
          if (typeof raw !== "string" || !raw.startsWith("{")) {
            browser.send(raw);
            return;
          }
          const envelope = JSON.parse(raw);
          const message = envelope.type === "session" ? envelope.message : envelope;
          if (message.payload?.status === "server_info")
            delete message.payload.features.hostInputQueue;
          const strip = (value: unknown): void => {
            if (!value || typeof value !== "object") return;
            if ("participants" in value)
              delete (value as { discussionActive?: boolean }).discussionActive;
            for (const nested of Object.values(value)) strip(nested);
          };
          strip(message);
          browser.send(JSON.stringify(envelope));
        });
      });
    await page.addInitScript(() =>
      localStorage.setItem("@clisbot:app-settings", JSON.stringify({ sendBehavior: "queue" })),
    );
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "compact-visual" });
    const bot = (
      await client.createBot({
        name: "Queue visual fixture",
        launch: { provider: "mock", model: "one-minute-stream", modeId: "load-test" },
      })
    ).bot!;
    const chat = (await client.createChat({ botIds: [bot.id], kind: manual ? "group" : "direct" }))
      .chat!;
    try {
      await client.sendChatMessage({ chatId: chat.id, text: "Visual fixture active turn" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/h/${getServerId()}/chat/${chat.id}`);
      const scope = page.getByTestId("chat-composer");
      const input = scope.getByRole("textbox").last();
      await expect(input).toBeEditable();
      await expect(page.getByTestId("turn-working-indicator").first()).toBeVisible();
      await attachFileFromMenu(page, {
        name: "context.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Visual attachment"),
      });
      await attachComposerTestImage(page);
      for (const text of [
        "Review the login flow and preserve the original draft",
        "Second queued message",
        "Third queued message",
      ]) {
        await input.fill(text);
        await scope.getByTestId("composer-send-button").tap();
        await expect(input).toHaveValue("");
      }
      await expect(scope.locator('[data-testid^="host-queue-"]')).toHaveCount(3);
      await expect(page.locator(".__expo_fast_refresh")).toHaveCount(0);
      for (const [name, width, height] of [
        ["phone", 390, 844],
        ["desktop", 1100, 900],
      ] as const) {
        await page.setViewportSize({ width, height });
        await expect(page.getByText("Updating messages", { exact: true })).toHaveCount(0);
        const first = scope.locator('[data-testid^="host-queue-"]').first();
        await expect(first).toBeVisible();
        {
          await expect(scope.getByText("Client queue (this app)", { exact: true })).toHaveCount(0);
          const box = (await first.boundingBox())!;
          expect(box.height).toBeLessThanOrEqual(56);
          // A phone row shows Send and ⋯; a desktop row shows Send, and View, Edit and Delete
          // over its first line while hovered (packages/app/src/composer/queue-row.tsx).
          const send = manual ? "Send message" : "Steer this send";
          const labels =
            name === "phone" ? ["More actions", send] : ["View", "Edit", "Delete", send];
          if (name === "desktop") await first.hover();
          for (const label of labels) {
            const button = first.getByRole("button", { name: label, exact: true });
            const target = (await button.boundingBox())!;
            expect(target.height).toBeGreaterThanOrEqual(44);
            expect(target.y + target.height).toBeLessThanOrEqual(height);
            const hit = await button.evaluate((node) => {
              const b = node.getBoundingClientRect();
              return node.contains(
                document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2),
              );
            });
            expect(hit).toBe(true);
          }
        }
        await page.screenshot({
          path: info.outputPath(`after-${manual ? "manual" : "default"}-${name}.png`),
        });
      }
      if (manual) {
        const badge = scope.getByRole("button", { name: "Manual", exact: true }).first();
        await badge.click();
        await expect(page.getByText(/This Host cannot report when the group ends/)).toBeVisible();
        const explanation = page.getByText(/This Host cannot report when the group ends/);
        await expect
          .poll(() =>
            explanation.evaluate((node) => {
              let opacity = 1;
              for (let current: Element | null = node; current; current = current.parentElement)
                opacity *= Number(getComputedStyle(current).opacity);
              return opacity;
            }),
          )
          .toBeGreaterThanOrEqual(0.99);
        await page.screenshot({ path: info.outputPath("manual-explanation-desktop.png") });
      }
      await writeFile(
        info.outputPath("visual-source.json"),
        JSON.stringify(
          {
            baseline: false,
            production: true,
            manual,
            platform: "Chromium web",
            viewports: [
              [390, 844],
              [1100, 900],
            ],
          },
          null,
          2,
        ),
      );
    } finally {
      await client.archiveChat({ chatId: chat.id });
      await client.archiveBot({ botId: bot.id });
      await client.removeProject(bot.projectId);
      await client.close();
    }
  });
}
