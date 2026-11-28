import { test, expect, type Page } from "../support/fixtures";
import { openWorkspaceWithAgents } from "../support/helpers/archive-tab";
import {
  composerLocator,
  expectComposerVisible,
  fillComposerDraft,
} from "../support/helpers/composer";
import {
  expectComposerToolbarOnTextRails,
  expectTrailingActionSwap,
  expectNoCollapsedComposerToolbarFrame,
  expectNoFrameTruncatesModelBesideThinking,
  readSettledModelTriggerLabels,
  readTrailingActionFrames,
  recordComposerToolbarFrames,
  recordModelTriggerFramesFromLoad,
  recordTrailingActionFrames,
  sweepModelTriggerLabels,
} from "../support/helpers/composer-control-density";
import {
  composerModelChip,
  composerPickerPanel,
  openComposerPicker,
  closeComposerPicker,
} from "../support/helpers/composer-picker";
import { clickNewChat, gotoWorkspace } from "../support/helpers/launcher";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

const COMBINED_PICKER = process.env.EXPO_PUBLIC_CLISBOT_COMPOSER_PICKER !== "0";
const SETTLE_MS = 1_000;
const TRAILING_ACTION_SETTLE_MS = 500;
const VOICE_MODE = "Enable Voice mode";
const SEND = "Send message";

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

test.describe("Composer trailing action", () => {
  test.describe.configure({ timeout: 120_000 });

  for (const viewport of [
    { name: "wide", width: 1280, height: 800 },
    { name: "compact", width: 390, height: 844 },
  ]) {
    test(`swaps in place between voice mode and Send at ${viewport.name} width`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const agent = await seedMockAgentWorkspace({
        repoPrefix: "composer-trailing-action-",
        title: "Trailing action",
      });
      try {
        await openAgentRoute(page, agent);
        await expectComposerVisible(page);
        await expect(page.getByRole("button", { name: VOICE_MODE, exact: true })).toBeVisible();
        const composer = composerLocator(page);
        await composer.focus();

        await recordTrailingActionFrames(page);
        await composer.press("x");
        await expect(composer).toHaveValue("x");
        await page.waitForTimeout(TRAILING_ACTION_SETTLE_MS);
        expectTrailingActionSwap(await readTrailingActionFrames(page), {
          from: VOICE_MODE,
          to: SEND,
        });

        await recordTrailingActionFrames(page);
        await composer.press("Backspace");
        await expect(composer).toHaveValue("");
        await page.waitForTimeout(TRAILING_ACTION_SETTLE_MS);
        expectTrailingActionSwap(await readTrailingActionFrames(page), {
          from: SEND,
          to: VOICE_MODE,
        });
      } finally {
        await agent.cleanup();
      }
    });
  }
});

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

test.describe("Composer controls folding on a touch device", () => {
  test.use({ viewport: { width: 1194, height: 834 }, isMobile: true, hasTouch: true });
  test.describe.configure({ timeout: 180_000 });

  test("an open menu stays closed after the controls fold and unfold", async ({ page }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "composer-density-fold-",
      title: "Folding chat",
      model: "ten-second-stream",
    });
    try {
      await openAgentRoute(page, session);
      if (COMBINED_PICKER) {
        await openComposerPicker(page);
        await closeComposerPicker(page);
        for (const width of [640, 390, 1194]) {
          await page.setViewportSize({ width, height: 834 });
          await expect(composerModelChip(page)).toBeVisible();
          await expect(composerPickerPanel(page)).toHaveCount(0);
        }
        await openComposerPicker(page);
        await closeComposerPicker(page);
        return;
      }
      const thinking = page.getByTestId("agent-thinking-selector").filter({ visible: true });
      const thinkingMenu = page.getByTestId("combobox-desktop-container");

      await thinking.click();
      await expect(thinkingMenu).toBeVisible();

      // Still a wide layout, but too narrow for separate controls: they fold into the model control.
      await page.setViewportSize({ width: 640, height: 834 });
      await expect(thinking).toHaveCount(0);

      await page.setViewportSize({ width: 1194, height: 834 });
      await expect(thinking).toBeVisible();
      await expect(thinkingMenu).toHaveCount(0);
    } finally {
      await session.cleanup();
    }
  });
});

test.describe("Folded model control on a phone", () => {
  // Start with room for both labels, then follow the toolbar through progressively narrower sizes.
  test.use({ viewport: { width: 600, height: 844 }, isMobile: true, hasTouch: true });
  test.describe.configure({ timeout: 180_000 });

  test(
    COMBINED_PICKER
      ? "keeps the active model and effort readable on the compact picker"
      : "hides the thinking label before the model label truncates",
    async ({ page }) => {
      const session = await seedMockAgentWorkspace({
        repoPrefix: "composer-density-labels-",
        title: "Label priority chat",
        model: "ten-second-stream",
      });
      try {
        if (COMBINED_PICKER) {
          await openAgentRoute(page, session);
          const chip = composerModelChip(page);
          for (const width of [480, 390, 320, 280]) {
            await page.setViewportSize({ width, height: 844 });
            await expect(chip).toHaveAccessibleName(/Ten second stream.*Low/i);
            await chip.scrollIntoViewIfNeeded();
            await expect(chip).toBeInViewport({ ratio: 1 });
            await expect(chip).toContainText(/Ten second stream/i);
          }
          await openComposerPicker(page);
          await expect(
            composerPickerPanel(page).getByTestId("composer-picker-reasoning"),
          ).toBeVisible();
          return;
        }
        await page.setViewportSize({ width: 1194, height: 844 });
        await recordModelTriggerFramesFromLoad(page);
        await openAgentRoute(page, session);
        await expect(thinkingControl(page, "Low")).toBeVisible();
        await page.setViewportSize({ width: 480, height: 844 });
        await expect(
          page.getByTestId("combined-model-selector-model-label").filter({ visible: true }),
        ).toHaveText("Ten second stream");
        await readSettledModelTriggerLabels(page);
        // From the first frame on, the control never guesses: it paints both labels only once it
        // has measured that they fit.
        await expectNoFrameTruncatesModelBesideThinking(page);

        const sweep = await sweepModelTriggerLabels(page, {
          from: 480,
          to: 280,
          step: 4,
          height: 844,
        });

        expect(sweep.widest).toMatchObject({
          modelText: "Ten second stream",
          modelTruncated: false,
        });
        expect(sweep.thinkingHidden).toMatchObject({
          modelText: "Ten second stream",
          modelTruncated: false,
        });
        expect(sweep.modelTruncated.width).toBeLessThan(sweep.thinkingHidden.width);
        // A clean tail: the label ends on a whole word and the ellipsis, never on a space.
        expect(sweep.modelTruncated).toMatchObject({
          modelText: "Ten second…",
          thinkingShown: false,
        });
      } finally {
        await session.cleanup();
      }
    },
  );
});

test.describe("Composer toolbar rails on touch", () => {
  test.use({ isMobile: true, hasTouch: true });
  test.describe.configure({ timeout: 180_000 });

  for (const viewport of [
    { device: "phone", width: 390, height: 844 },
    { device: "tablet", width: 1024, height: 1366 },
  ]) {
    test(`the toolbar starts on the text rail and ends in a disc nested in the corner on a ${viewport.device}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const idle = await seedMockAgentWorkspace({
        repoPrefix: "composer-rails-idle-",
        title: "Rails idle chat",
      });
      let running: Awaited<ReturnType<typeof seedMockAgentWorkspace>> | null = null;
      try {
        await openAgentRoute(page, idle);
        await expect(page.getByTestId("message-input-root").filter({ visible: true })).toBeVisible({
          timeout: 30_000,
        });
        await test.step("empty composer: attach on the left, voice mode on the right", async () => {
          await expectComposerToolbarOnTextRails(page);
        });
        await test.step("draft: the send disc on the right", async () => {
          await fillComposerDraft(page, "Refactor the composer toolbar");
          await expect(page.getByRole("button", { name: /send/i }).first()).toBeVisible();
          await expectComposerToolbarOnTextRails(page);
        });

        running = await seedMockAgentWorkspace({
          repoPrefix: "composer-rails-running-",
          title: "Rails running chat",
          model: "one-minute-stream",
          initialPrompt: "stream for a while",
        });
        await openAgentRoute(page, running);
        await test.step("running agent: the stop disc on the right", async () => {
          await expect(page.getByRole("button", { name: /stop agent/i }).first()).toBeVisible({
            timeout: 30_000,
          });
          await expectComposerToolbarOnTextRails(page);
        });
      } finally {
        await idle.cleanup();
        await running?.cleanup();
      }
    });
  }
});

test.describe("Composer trailing disc on a new chat", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 1024, height: 1366 } });

  test("an empty draft only enables Send after text is entered", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "composer-placeholder-send-" });
    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewChat(page);
      const send = page
        .getByTestId("message-input-root")
        .filter({ visible: true })
        .getByRole("button", { name: "Send message", exact: true });
      if (COMBINED_PICKER) {
        await expect(
          page
            .getByTestId("composer-circle")
            .filter({ visible: true })
            .getByRole("button", { name: "Start dictation" }),
        ).toBeVisible();
        await expect(send).toHaveCount(0);
      } else {
        await expect(send).toBeDisabled({ timeout: 30_000 });
      }
      await fillComposerDraft(page, "Refactor the composer toolbar");
      await expect(send).toBeEnabled();
    } finally {
      await workspace.cleanup();
    }
  });
});

const SHORTCUT_MOD = process.platform === "darwin" ? "Meta" : "Control";

async function toggleModelPickerFromComposer(page: Page) {
  await composerLocator(page).focus();
  await page.keyboard.press(`${SHORTCUT_MOD}+Slash`);
}

async function expectModelPickerClosesFromSearch(page: Page) {
  const search = page.getByPlaceholder(/Search (all )?models/);
  await expect(search).toBeVisible();
  await search.focus();
  await page.keyboard.press(`${SHORTCUT_MOD}+Slash`);
  await expect(search).toBeHidden();
}

async function cycleComposerEffort(page: Page) {
  await composerLocator(page).focus();
  await page.keyboard.press(`${SHORTCUT_MOD}+Shift+Slash`);
}

function modelControl(page: Page) {
  return page.getByRole("button", { name: "Select model (Ten second stream)", exact: true });
}

function thinkingControl(page: Page, effort: string) {
  return page.getByRole("button", { name: `Select thinking option (${effort})`, exact: true });
}

async function expectShortcutHint(
  page: Page,
  control: ReturnType<typeof modelControl>,
  label: string,
) {
  await control.hover();
  const tooltip = page.getByRole("tooltip").filter({ hasText: label });
  await expect(tooltip).toContainText("/");
}

test.describe("Composer model and effort shortcuts", () => {
  test("opens and closes the model picker and wraps effort in toolbar order", async ({ page }) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "composer-shortcuts-",
      title: "Composer shortcuts",
      model: "ten-second-stream",
      thinkingOptionId: "high",
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      if (COMBINED_PICKER) {
        const chip = composerModelChip(page);
        await expect(chip).toHaveAccessibleName(/Ten second stream.*High/i);
        await toggleModelPickerFromComposer(page);
        await expect(page.getByTestId("composer-picker-search")).toBeFocused();
        await page.keyboard.press(`${SHORTCUT_MOD}+Slash`);
        await expect(composerPickerPanel(page)).toHaveCount(0);
        for (const effort of ["Low", "Medium", "High"]) {
          if (effort === "High") await page.setViewportSize({ width: 480, height: 844 });
          await cycleComposerEffort(page);
          await expect(chip).toHaveAccessibleName(new RegExp("Ten second stream.*" + effort, "i"));
        }
        return;
      }
      await expect(thinkingControl(page, "High")).toBeVisible();

      await test.step("Focus model search without opening its tooltip", async () => {
        await toggleModelPickerFromComposer(page);
        await expect(page.getByPlaceholder(/Search (all )?models/)).toBeFocused();
        await expect(page.getByRole("tooltip").filter({ hasText: "Change model" })).toBeHidden();
        await expectModelPickerClosesFromSearch(page);
      });

      await test.step("Show both shortcuts in the toolbar tooltips", async () => {
        await expectShortcutHint(page, modelControl(page), "Change model");
        await expectShortcutHint(page, thinkingControl(page, "High"), "Thinking mode");
      });

      await test.step("Wrap from High to Low and advance to Medium", async () => {
        await cycleComposerEffort(page);
        await expect(thinkingControl(page, "Low")).toBeVisible();
        await cycleComposerEffort(page);
        await expect(thinkingControl(page, "Medium")).toBeVisible();
      });

      await test.step("Toggle the folded picker and cycle effort in a compact window", async () => {
        await page.setViewportSize({ width: 480, height: 844 });
        const effortLabel = page.getByTestId("combined-model-selector-thinking-label");
        await expect(effortLabel).toHaveText("Medium");
        await toggleModelPickerFromComposer(page);
        await expectModelPickerClosesFromSearch(page);
        await cycleComposerEffort(page);
        await expect(effortLabel).toHaveText("High");
      });
    } finally {
      await agent.cleanup();
    }
  });
});
