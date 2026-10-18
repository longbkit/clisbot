import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { longPressSend } from "../support/helpers/queue-send-gesture";
import { attachFileFromMenu } from "../support/helpers/composer";
import { expect, test, disabledQueueProviders } from "../support/helpers/queue-fixture";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
test.use({
  hasTouch: true,
  e2eDaemonConfig: {
    version: 1,
    features: { hostInputQueue: false },
    agents: {
      providers: disabledQueueProviders,
    },
  },
});
test("disabled Host queue retains dismissed drafts and admits attachments through the client queue", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    localStorage.setItem("@clisbot:app-settings", JSON.stringify({ sendBehavior: "steer" })),
  );
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "queue-disabled-",
    title: "Queue disabled fixture",
    model: "one-minute-stream",
  });
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "disabled-queue-drain-control",
  });
  try {
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });
    const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
    await composer.fill("Normal idle send remains available");
    await page.getByTestId("composer-send-button").tap();
    await expect(page.getByTestId("turn-working-indicator").first()).toBeVisible();
    await attachFileFromMenu(page, {
      name: "retained.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Keep client queue bytes"),
    });
    await composer.fill("Keep this client queue draft");
    await longPressSend(page, page.locator("body"));
    await expect(composer).toHaveValue("Keep this client queue draft");
    await page.touchscreen.tap(12, 12);
    await expect(page.getByTestId("composer-send-once-queue")).toHaveCount(0);
    await expect(composer).toHaveValue("Keep this client queue draft");
    await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("@clisbot:app-settings")!).sendBehavior,
      ),
    ).toBe("steer");
    await longPressSend(page, page.locator("body"));
    await page.getByTestId("composer-send-once-queue").tap();
    await expect(composer).toHaveValue("");
    const row = page
      .locator('[data-testid^="host-queue-"]')
      .filter({ hasText: "Keep this client queue draft" });
    await expect(row).toBeVisible();
    await expect(row.getByLabel("Attachments (1)", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Update this Host" })).toHaveCount(0);
    expect(client.getLastServerInfoMessage()?.features?.hostInputQueue).not.toBe(true);
    await row.getByRole("button", { name: "Edit", exact: true }).tap();
    await expect(composer).toHaveValue("Keep this client queue draft");
    await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
    await page.getByTestId("composer-send-button").tap();
    await expect(composer).toHaveValue("");
    await expect(row).toBeVisible();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("@clisbot:app-settings")!).sendBehavior,
      ),
    ).toBe("steer");
    await client.cancelAgent(workspace.agentId);
    await expect(row).toHaveCount(0);
    await expect(page.getByText("Keep this client queue draft", { exact: true })).toBeVisible();
  } finally {
    await client.close();
    await workspace.cleanup();
  }
});
