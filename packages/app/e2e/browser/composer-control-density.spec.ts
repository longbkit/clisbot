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

// The Clisbot chat layout (docs/features/composer-picker/README.md, "Layout"): voice and the
// dictation circle inside the container, and Send taking the circle's place.
test("compact actions paint their faces inside separate touch targets", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "composer-touch-target-" });
  try {
    const agent = await seedSettledMockAgent(workspace, "Touch target");
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentRoute(page, { agentId: agent.id, workspaceId: workspace.workspaceId });
    const input = composerLocator(page);
    const dictation = page.getByRole("button", { name: "Start dictation", exact: true });
    const voice = page.getByRole("button", { name: "Enable Voice mode", exact: true });
    async function expectGeometry(
      button: import("@playwright/test").Locator,
      faceId: string,
      target: { width: number; height: number },
      face: number,
    ) {
      await expect.poll(async () => (await button.boundingBox())?.width).toBe(target.width);
      await expect.poll(async () => (await button.boundingBox())?.height).toBe(target.height);
      const painted = button.getByTestId(faceId);
      await expect.poll(async () => (await painted.boundingBox())?.width).toBe(face);
      await expect.poll(async () => (await painted.boundingBox())?.height).toBe(face);
    }
    async function expectSeparateAligned(
      a: import("@playwright/test").Locator,
      b: import("@playwright/test").Locator,
    ) {
      const first = (await a.boundingBox())!;
      const second = (await b.boundingBox())!;
      expect(first.x + first.width).toBeLessThanOrEqual(second.x);
      expect(first.y + first.height / 2).toBe(second.y + second.height / 2);
      expect(second.x + second.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    const circle = { width: 48, height: 48 };
    await expectGeometry(dictation, "composer-dictation-face", circle, 40);
    await expectGeometry(voice, "composer-realtime-voice-face", { width: 44, height: 48 }, 36);
    await expectSeparateAligned(voice, dictation);
    await input.fill("A multiline draft\nwith a larger Send target");
    const send = page.getByRole("button", { name: "Send message", exact: true });
    await expect(send).toBeVisible();
    await expect(dictation).toHaveCount(0);
    await expectGeometry(send, "composer-send-face", circle, 40);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expectGeometry(send, "composer-send-face", circle, 40);
    await page.setViewportSize({ width: 360, height: 740 });
    await expectGeometry(send, "composer-send-face", circle, 40);
    const bounds = (await send.boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(input).toHaveValue("");
    const stop = page.getByRole("button", { name: "Stop agent", exact: true });
    await expect(stop).toBeVisible();
    await expectGeometry(stop, "composer-stop-face", circle, 40);
    const stopBounds = (await stop.boundingBox())!;
    await page.mouse.click(stopBounds.x + 4, stopBounds.y + stopBounds.height / 2);
    await expect(stop).not.toBeVisible({ timeout: 30_000 });
  } finally {
    await workspace.cleanup();
  }
});
