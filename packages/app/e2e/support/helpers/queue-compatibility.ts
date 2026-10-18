import { writeFile } from "node:fs/promises";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { test, expect, disabledQueueProviders } from "./queue-fixture";
import { daemonWsRoutePattern } from "./daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "./mock-agent";
import { longPressSend } from "./queue-send-gesture";
import { attachFileFromMenu } from "./composer";
import { connectDaemonClient } from "./daemon-client-loader";

export function registerSessionQueueCompatibility(mode: "legacy" | "upgrade") {
  test.use({
    hasTouch: true,
    e2eDaemonConfig: {
      version: 1,
      features: { hostInputQueue: mode === "upgrade" },
      agents: { providers: disabledQueueProviders },
    },
  });
  for (const capability of ["absent", "off"] as const) {
    for (const preference of ["queue", "steer"] as const) {
      if (mode === "upgrade" && (capability !== "absent" || preference !== "queue")) continue;
      test(`${capability} capability: busy ${preference}, explicit Queue, edit/files and upgrade ownership`, async ({
        page,
      }, info) => {
        let upgraded = false;
        let publishUpgrade: (() => void) | undefined;
        let hostFetches = 0;
        const violations: unknown[] = [];
        const sends: Array<Record<string, unknown>> = [];
        await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
          const server = browser.connectToServer();
          browser.onMessage((raw) => {
            if (typeof raw !== "string" || !raw.startsWith("{")) {
              server.send(raw);
              return;
            }
            const envelope = JSON.parse(String(raw));
            const request = envelope.type === "session" ? envelope.message : envelope;
            if (
              !upgraded &&
              (request.type === "agent.queue.execute.request" || request.expectedTurnId)
            )
              violations.push(request);
            if (upgraded && request.type === "agent.queue.execute.request") hostFetches++;
            if (request.type === "send_agent_message_request") sends.push(request);
            server.send(raw);
          });
          server.onMessage((raw) => {
            if (typeof raw !== "string" || !raw.startsWith("{")) {
              browser.send(raw);
              return;
            }
            const envelope = JSON.parse(String(raw));
            const message = envelope.type === "session" ? envelope.message : envelope;
            if (message.payload?.status === "server_info") {
              publishUpgrade = () => {
                upgraded = true;
                browser.close();
              };
              if (!upgraded) {
                if (capability === "absent") delete message.payload.features.hostInputQueue;
                else message.payload.features.hostInputQueue = false;
              }
              browser.send(JSON.stringify(envelope));
            } else browser.send(raw);
          });
        });
        await page.addInitScript((sendBehavior) => {
          const settings = JSON.parse(localStorage.getItem("@clisbot:app-settings") ?? "{}");
          localStorage.setItem(
            "@clisbot:app-settings",
            JSON.stringify({ ...settings, sendBehavior }),
          );
        }, preference);
        const workspace = await seedMockAgentWorkspace({
          repoPrefix: "queue-compat-",
          title: "Legacy queue",
          model: "one-minute-stream",
          initialPrompt: "Keep fixture busy",
        });
        const client = await connectDaemonClient<DaemonClient>({
          clientIdPrefix: "queue-compat-control",
        });
        try {
          if (mode === "legacy")
            expect(client.getLastServerInfoMessage()?.features?.hostInputQueue).not.toBe(true);
          await page.setViewportSize({ width: 390, height: 844 });
          await openAgentRoute(page, workspace);
          const input = page.getByRole("textbox").last();
          await expect(page.getByTestId("turn-working-indicator").first()).toBeVisible();
          await input.fill(`Default ${preference}`);
          await page.getByTestId("composer-send-button").tap();
          await expect(input).toHaveValue("");
          if (preference === "queue")
            await expect(page.getByText("Default queue", { exact: true })).toBeVisible();
          else {
            await expect.poll(() => sends.length).toBe(1);
            expect(sends[0]).toMatchObject({ activeTurnBehavior: "steer" });
            expect(sends[0]).not.toHaveProperty("expectedTurnId");
          }
          await attachFileFromMenu(page, {
            name: "legacy.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("legacy retained bytes"),
          });
          await input.fill("Explicit local queue");
          await longPressSend(page, page.locator("body"));
          await page.getByTestId("composer-send-once-queue").tap();
          await expect(input).toHaveValue("");
          const row = page
            .locator('[data-testid^="host-queue-"]')
            .filter({ hasText: "Explicit local queue" });
          await expect(row).toBeVisible();
          const rowId = await row.getAttribute("data-testid");
          await row.getByRole("button", { name: "Edit", exact: true }).tap();
          await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
          await input.fill("Edited local queue");
          await page.getByTestId("composer-send-button").tap();
          await expect(page.getByTestId(rowId!)).toContainText("Edited local queue");
          await expect(
            page.getByTestId(rowId!).getByLabel("Attachments (1)", { exact: true }),
          ).toBeVisible();
          expect(violations).toEqual([]);
          await page.screenshot({ path: info.outputPath("legacy-client-queue.png") });
          if (mode === "legacy") {
            await page
              .getByTestId(rowId!)
              .getByRole("button", { name: "Delete", exact: true })
              .tap();
            await expect(page.getByTestId(rowId!)).toHaveCount(0);
            if (preference === "queue") {
              await client.cancelAgent(workspace.agentId);
              await expect
                .poll(() => sends.filter((send) => send.text === "Default queue").length)
                .toBe(1);
            }
            await writeFile(
              info.outputPath("legacy-wire.json"),
              JSON.stringify({ mode, capability, preference, violations, sends }, null, 2),
            );
            return;
          }
          publishUpgrade!();
          await expect.poll(() => hostFetches).toBeGreaterThan(0);
          await expect(page.getByTestId(rowId!)).toBeVisible();
          await input.fill("Durable after upgrade");
          await longPressSend(page, page.locator("body"));
          await page.getByTestId("composer-send-once-queue").tap();
          await expect(input).toHaveValue("");
          await expect
            .poll(
              async () =>
                (
                  await client.executeAgentQueueCommand({
                    agentId: workspace.agentId,
                    command: { action: "fetch" },
                  })
                ).queue?.items.length,
            )
            .toBe(1);
          await expect(page.getByTestId(rowId!)).toContainText("Edited local queue");
          await page.getByTestId(rowId!).getByRole("button", { name: "Delete", exact: true }).tap();
          await expect(page.getByTestId(rowId!)).toHaveCount(0);
          expect(
            (
              await client.executeAgentQueueCommand({
                agentId: workspace.agentId,
                command: { action: "fetch" },
              })
            ).queue!.items,
          ).toHaveLength(1);
          if (preference === "queue") {
            await client.cancelAgent(workspace.agentId);
            await expect
              .poll(() => sends.filter((send) => send.text === "Default queue").length)
              .toBe(1);
            await expect(
              page.locator('[data-testid^="host-queue-"]').filter({ hasText: "Default queue" }),
            ).toHaveCount(0);
          }
          expect(
            await page.evaluate(
              () => JSON.parse(localStorage.getItem("@clisbot:app-settings")!).sendBehavior,
            ),
          ).toBe(preference);
          await writeFile(
            info.outputPath("legacy-wire.json"),
            JSON.stringify({ capability, preference, violations, sends }, null, 2),
          );
        } catch (error) {
          await page.screenshot({ path: info.outputPath("failure-before-cleanup.png") });
          await writeFile(
            info.outputPath("failure-wire.json"),
            JSON.stringify({ mode, capability, preference, violations, sends }, null, 2),
          );
          throw error;
        } finally {
          await client.close();
          await workspace.cleanup();
        }
      });
    }
  }
}
