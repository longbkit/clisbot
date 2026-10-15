import { test, expect } from "../support/fixtures";
import { openWorkspaceWithAgents } from "../support/helpers/archive-tab";
import {
  expectNoCollapsedComposerToolbarFrame,
  recordComposerToolbarFrames,
} from "../support/helpers/composer-control-density";
import { clickNewChat, gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { composerLocator } from "../support/helpers/composer";

const SETTLE_MS = 1_000;

async function seedSettledMockAgent(workspace: SeededWorkspace, title: string) {
  const agent = await workspace.client.createAgent({
    provider: "mock",
    model: "ten-second-stream",
    modeId: "load-test",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title,
  });
  await workspace.client.waitForAgentUpsert(
    agent.id,
    (snapshot) => snapshot.status === "idle",
    30_000,
  );
  return { id: agent.id, title, cwd: workspace.repoPath, workspaceId: workspace.workspaceId };
}

function visibleAgentTab(page: import("@playwright/test").Page, agentId: string) {
  return page.getByTestId(`workspace-tab-agent_${agentId}`).filter({ visible: true }).first();
}

test.describe("Composer control density across tab switches", () => {
  test.describe.configure({ timeout: 180_000 });

  test("switching between agent tabs never paints a collapsed composer toolbar", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "composer-density-agents-" });
    try {
      const first = await seedSettledMockAgent(workspace, "First chat");
      const second = await seedSettledMockAgent(workspace, "Second chat");
      await openWorkspaceWithAgents(page, [first, second]);

      await recordComposerToolbarFrames(page);
      await visibleAgentTab(page, first.id).click();
      await page.waitForTimeout(SETTLE_MS);
      await visibleAgentTab(page, second.id).click();
      await page.waitForTimeout(SETTLE_MS);

      await expectNoCollapsedComposerToolbarFrame(page);
    } finally {
      await workspace.cleanup();
    }
  });

  test("switching between draft tabs never paints a collapsed composer toolbar", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "composer-density-drafts-" });
    try {
      await page.addInitScript(() => {
        localStorage.setItem(
          "@clisbot:create-agent-preferences",
          JSON.stringify({
            provider: "mock",
            providerPreferences: { mock: { mode: "load-test" } },
          }),
        );
      });
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewChat(page);
      await clickNewChat(page);

      const draftTabs = page
        .locator('[data-testid^="workspace-tab-draft"]')
        .filter({ visible: true });
      await expect(draftTabs).toHaveCount(2, { timeout: 30_000 });
      await expect(
        page.locator('[data-testid="mode-control"]').filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      await recordComposerToolbarFrames(page);
      await draftTabs.nth(0).click();
      await page.waitForTimeout(SETTLE_MS);
      await draftTabs.nth(1).click();
      await page.waitForTimeout(SETTLE_MS);

      await expectNoCollapsedComposerToolbarFrame(page);
    } finally {
      await workspace.cleanup();
    }
  });
});

test("compact primary action paints a 48px target and accepts its outer edge", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "composer-touch-target-" });
  try {
    const agent = await seedSettledMockAgent(workspace, "Touch target");
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentRoute(page, { agentId: agent.id, workspaceId: workspace.workspaceId });
    const input = composerLocator(page);
    await input.fill("A multiline draft\nwith a larger Send target");
    const send = page.getByRole("button", { name: "Send message", exact: true });
    await expect(send).toBeVisible();
    await expect.poll(async () => (await send.boundingBox())?.width).toBe(48);
    await expect.poll(async () => (await send.boundingBox())?.height).toBe(48);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(async () => (await send.boundingBox())?.width).toBe(28);
    await expect.poll(async () => (await send.boundingBox())?.height).toBe(28);
    await page.setViewportSize({ width: 360, height: 740 });
    await expect.poll(async () => (await send.boundingBox())?.width).toBe(48);
    const bounds = (await send.boundingBox())!;
    // Outside the old centered 28px target, inside the new painted circle.
    await page.mouse.click(bounds.x + 4, bounds.y + bounds.height / 2);
    await expect(input).toHaveValue("");
    const stop = page.getByRole("button", { name: "Stop agent", exact: true });
    await expect(stop).toBeVisible();
    await expect.poll(async () => (await stop.boundingBox())?.width).toBe(48);
    await expect.poll(async () => (await stop.boundingBox())?.height).toBe(48);
    const stopBounds = (await stop.boundingBox())!;
    await page.mouse.click(stopBounds.x + 4, stopBounds.y + stopBounds.height / 2);
    await expect(stop).not.toBeVisible({ timeout: 30_000 });
  } finally {
    await workspace.cleanup();
  }
});
