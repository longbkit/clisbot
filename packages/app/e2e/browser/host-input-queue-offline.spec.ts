import { writeFile } from "node:fs/promises";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { test, expect, disabledQueueProviders } from "../support/helpers/queue-fixture";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { longPressSend } from "../support/helpers/queue-send-gesture";
import { attachFileFromMenu } from "../support/helpers/composer";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";

test.use({
  hasTouch: true,
  e2eDaemonConfig: { version: 1, agents: { providers: disabledQueueProviders } },
});

test("disconnected capability retains accepted Host item and refuses queue without moving draft/files", async ({
  page,
}, info) => {
  let disconnect: (() => void) | undefined;
  const requests: unknown[] = [];
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    disconnect = () => browser.close();
    browser.onMessage((raw) => {
      if (typeof raw === "string" && raw.startsWith("{")) {
        const envelope = JSON.parse(raw);
        const request = envelope.type === "session" ? envelope.message : envelope;
        if (request.type === "agent.queue.execute.request") requests.push(request);
      }
      server.send(raw);
    });
  });
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "queue-offline-",
    title: "Accepted Host queue",
    model: "one-minute-stream",
    initialPrompt: "Keep active while disconnected",
  });
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "offline-queue-control",
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentRoute(page, workspace);
    const input = page.getByRole("textbox").last();
    await expect(input).toBeEditable();
    await input.fill("Already accepted by Host");
    await longPressSend(page, page.locator("body"));
    await page.getByTestId("composer-send-once-queue").tap();
    await expect(input).toHaveValue("");
    const original = (
      await client.executeAgentQueueCommand({
        agentId: workspace.agentId,
        command: { action: "fetch" },
      })
    ).queue!;
    expect(original.items).toHaveLength(1);
    const row = page.getByTestId(`host-queue-${original.items[0].id}`);
    await expect(row).toBeVisible();
    await attachFileFromMenu(page, {
      name: "offline.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("unsent draft bytes"),
    });
    // setFiles only starts upload; prove the attachment was accepted before disconnecting.
    await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
    await input.fill("Keep this offline draft");
    await page.context().setOffline(true);
    disconnect!();
    await page.waitForTimeout(500);
    await expect(row).toBeVisible();
    await longPressSend(page, page.locator("body"));
    await page.getByTestId("composer-send-once-queue").tap();
    await expect(input).toHaveValue("Keep this offline draft");
    await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
    await expect(page.getByText("Client queue (this app)", { exact: true })).toHaveCount(0);
    await expect(row).toBeVisible();
    expect(
      (
        await client.executeAgentQueueCommand({
          agentId: workspace.agentId,
          command: { action: "fetch" },
        })
      ).queue!.items,
    ).toEqual(original.items);
    await page.screenshot({ path: info.outputPath("accepted-host-item-offline-draft.png") });
    await writeFile(
      info.outputPath("accepted-host-offline.json"),
      JSON.stringify({ original, requests }, null, 2),
    );
    await page.context().setOffline(false);
    await expect(input).toHaveValue("Keep this offline draft");
  } catch (error) {
    await page.screenshot({ path: info.outputPath("failure-before-cleanup.png") });
    throw error;
  } finally {
    await page.context().setOffline(false);
    await client.close();
    await workspace.cleanup();
  }
});
