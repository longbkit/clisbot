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
test("Queue reports an update requirement and retains the draft without a RAM fallback", async ({
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
      buffer: Buffer.from("Keep unsupported send bytes"),
    });
    await composer.fill("Keep this unaccepted queue draft");
    await longPressSend(page, page.locator("body"));
    await expect(composer).toHaveValue("Keep this unaccepted queue draft");
    await page.touchscreen.tap(12, 12);
    await expect(page.getByTestId("composer-send-once-queue")).toHaveCount(0);
    await expect(composer).toHaveValue("Keep this unaccepted queue draft");
    await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("@clisbot:app-settings")!).sendBehavior,
      ),
    ).toBe("steer");
    await longPressSend(page, page.locator("body"));
    await page.getByTestId("composer-send-once-queue").tap();
    await expect(composer).toHaveValue("Keep this unaccepted queue draft");
    await expect(
      page.getByRole("alert").filter({ hasText: "Update this Host" }).first(),
    ).toBeVisible();
    await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
    await longPressSend(page, page.locator("body"));
    await page.getByTestId("composer-send-once-steer").tap();
    await expect(composer).toHaveValue("Keep this unaccepted queue draft");
    await expect(page.getByTestId("composer-file-attachment-pill")).toBeVisible();
    await expect(page.getByTestId("turn-working-indicator").first()).toBeVisible();
    await expect(page.locator('[data-testid^="host-queue-"]')).toHaveCount(0);
  } finally {
    await workspace.cleanup();
  }
});
