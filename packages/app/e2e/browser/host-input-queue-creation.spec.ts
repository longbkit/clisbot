import { writeFile } from "node:fs/promises";
import { test, expect, disabledQueueProviders } from "../support/helpers/queue-fixture";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { longPressSend } from "../support/helpers/queue-send-gesture";

test.use({
  hasTouch: true,
  e2eDaemonConfig: { version: 1, agents: { providers: disabledQueueProviders } },
});

test("fresh Home and creation drafts have no queue target; existing session retains queue", async ({
  page,
  e2eWorkerClient,
}, info) => {
  const baseline = new Set(
    (await e2eWorkerClient.fetchWorkspaces()).entries.map((entry) => entry.projectId),
  );
  try {
    const requests: unknown[] = [];
    await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
      const server = browser.connectToServer();
      browser.onMessage((raw) => {
        const envelope = JSON.parse(String(raw));
        const request = envelope.type === "session" ? envelope.message : envelope;
        if (request.type === "agent.queue.execute.request") requests.push(request);
        server.send(raw);
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    // No workspace/agent is seeded before inspecting the actual fresh creation surface.
    for (const route of ["/", `/h/${getServerId()}/open-project`]) {
      await page.goto(route);
      const input = page.getByRole("textbox").last();
      await expect(input).toBeEditable();
      await input.fill("First creation prompt stays local");
      await expect(page.getByTestId("workspace-create-submit")).toBeEnabled();
      await page.waitForTimeout(2300); // Cover the queue projection polling interval.
      await page.screenshot({
        path: info.outputPath(route === "/" ? "fresh-home.png" : "fresh-new-workspace.png"),
      });
      await writeFile(
        info.outputPath("creation-queue-requests.json"),
        JSON.stringify(requests, null, 2),
      );
      expect(requests).toEqual([]);
      await expect(page.getByText(/Agent .* not found/)).toHaveCount(0);
      await expect(page.getByTestId("workspace-create-submit")).not.toHaveAttribute(
        "data-send-actions",
        "longpress",
      );
      await expect(input).toHaveValue("First creation prompt stays local");
    }
    await page.getByTestId("workspace-create-submit").tap();
    await expect(
      page
        .getByTestId("user-message")
        .filter({ hasText: "First creation prompt stays local" })
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("textbox").last()).toBeEditable();
    await page.screenshot({ path: info.outputPath("first-created-session.png") });
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "queue-create-control-",
      title: "Existing queue target",
    });
    try {
      await openAgentRoute(page, workspace);
      const input = page.getByRole("textbox").last();
      await expect(input).toBeEditable();
      await input.fill("Existing session one-off queue");
      await longPressSend(page, page.locator("body"));
      await expect(page.getByTestId("composer-send-once-queue")).toBeVisible();
      await page.getByTestId("composer-send-once-queue").tap();
      await expect(input).toHaveValue("");
      await expect.poll(() => requests.length).toBeGreaterThan(0);
      await page.screenshot({ path: info.outputPath("existing-session-queue.png") });
    } finally {
      await workspace.cleanup();
    }
  } finally {
    const created = (await e2eWorkerClient.fetchWorkspaces()).entries.filter(
      (entry) => !baseline.has(entry.projectId),
    );
    for (const projectId of new Set(created.map((entry) => entry.projectId)))
      await e2eWorkerClient.removeProject(projectId);
  }
});
