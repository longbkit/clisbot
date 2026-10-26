import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { writeFile } from "node:fs/promises";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { test, expect, disabledQueueProviders } from "../support/helpers/queue-fixture";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { pressQueueRowAction } from "../support/helpers/queue-row";

test.use({
  hasTouch: true,
  e2eDaemonConfig: { version: 1, agents: { providers: disabledQueueProviders } },
});

test("stale editor admits once while acknowledgement is held and retries the same admission", async ({
  page,
}, info) => {
  const admissions: string[] = [];
  const responses: (() => void)[] = [];
  const rejected: (() => void)[] = [];
  const pendingIds = new Set<string>();
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((raw) => {
      const envelope = JSON.parse(String(raw));
      const request = envelope.type === "session" ? envelope.message : envelope;
      if (request.type === "agent.queue.execute.request" && request.command?.action === "enqueue") {
        admissions.push(request.command.id);
        pendingIds.add(request.requestId);
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const envelope = JSON.parse(String(raw));
      const response = envelope.type === "session" ? envelope.message : envelope;
      if (
        response.type === "agent.queue.execute.response" &&
        pendingIds.has(response.payload?.requestId)
      ) {
        responses.push(browser.send.bind(browser, raw));
        rejected.push(
          browser.send.bind(
            browser,
            JSON.stringify({
              type: "session",
              message: {
                type: "rpc_error",
                payload: {
                  requestId: response.payload.requestId,
                  requestType: "agent.queue.execute.request",
                  error: "Held acknowledgement outcome unknown",
                  code: "handler_error",
                },
              },
            }),
          ),
        );
        return;
      }
      browser.send(raw);
    });
  });
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "queue-pending-",
    title: "Queue pending editor",
    model: "one-minute-stream",
    initialPrompt: "Hold fixture work",
  });
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "queue-editor-pending",
  });
  const queue = (command: Parameters<DaemonClient["executeAgentQueueCommand"]>[0]["command"]) =>
    client.executeAgentQueueCommand({ agentId: workspace.agentId, command });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const seeded = await queue({
      action: "enqueue",
      id: "original",
      text: "Original queued draft",
    });
    expect(seeded.error).toBeNull();
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: workspace.agentId });
    const input = page.getByRole("textbox").last();
    await pressQueueRowAction(page, page.getByTestId("host-queue-original"), "Edit");
    await input.fill("Deliberate new queued draft");
    const before = (await queue({ action: "fetch" })).queue!;
    await queue({ action: "delete", id: "original", revision: before.revision });
    await page.getByTestId("composer-send-button").click();
    const enqueue = page.getByRole("button", { name: "Add as new item", exact: true });
    await expect(enqueue).toBeVisible();
    await enqueue.click();
    await expect.poll(() => responses.length).toBe(1);
    if (await enqueue.isEnabled()) {
      await enqueue.click();
      await expect.poll(() => responses.length).toBe(2);
    }
    await writeFile(
      info.outputPath("held-ack-admissions.json"),
      JSON.stringify({ admissions, queue: (await queue({ action: "fetch" })).queue }, null, 2),
    );
    expect(new Set(admissions).size).toBe(1);
    expect((await queue({ action: "fetch" })).queue!.items).toHaveLength(1);
    await expect(enqueue).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel edit", exact: true })).toBeDisabled();
    await expect(input).not.toBeEditable();
    await expect(page.getByTestId("composer-send-button")).toBeDisabled();
    await expect(page.getByTestId("composer-send-button")).toHaveAttribute(
      "aria-label",
      "Save changes",
    );
    await expect(page.getByTestId("composer-send-button")).not.toHaveAttribute(
      "data-send-actions",
      "longpress",
    );
    await page.screenshot({
      path: info.outputPath("editor-pending-held-ack-development.png"),
      fullPage: false,
    });
    rejected.shift()!();
    responses.shift();
    await expect(enqueue).toBeEnabled();
    await expect(input).toHaveValue("Deliberate new queued draft");
    await enqueue.click();
    await expect.poll(() => admissions.length).toBe(2);
    await expect.poll(() => responses.length).toBe(1);
    expect(admissions[1]).toBe(admissions[0]);
    await writeFile(info.outputPath("retry-admission-ids.json"), JSON.stringify(admissions));
    expect((await queue({ action: "fetch" })).queue!.items).toHaveLength(1);
    for (const release of responses.splice(0)) release();
    await expect(input).toHaveValue("");
  } finally {
    for (const release of responses) release();
    await client.cancelAgent(workspace.agentId).catch(() => {});
    await client.close();
    await workspace.cleanup();
  }
});
