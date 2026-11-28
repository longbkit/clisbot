import { expect, test } from "../support/fixtures";
import { composerLocator, expectComposerVisible } from "../support/helpers/composer";
import {
  composerControl,
  expectGlyphMatchesLabel,
  expectIconOnlyGlyph,
  readComposerControlTone,
  readComposerPlaceholderTone,
  readComposerTextTone,
} from "../support/helpers/composer-toolbar-tone";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const USES_CLISBOT_PICKER = process.env.EXPO_PUBLIC_CLISBOT_COMPOSER_PICKER !== "0";
const MODEL_CHIP = "composer-model-chip";
const THINKING = "agent-thinking-selector";
const MODE = "mode-control";
const ATTACH = "message-input-attach-button";
const COMBINED_MODEL = "combined-model-selector";

async function openSeededComposer(
  page: import("@playwright/test").Page,
  repoPrefix: string,
  readyTestId = MODE,
) {
  const agent = await seedMockAgentWorkspace({
    repoPrefix,
    title: "Toolbar tone",
    model: "ten-second-stream",
  });
  try {
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    await expect(composerControl(page, readyTestId)).toBeVisible({ timeout: 30_000 });
    return agent;
  } catch (error) {
    await agent.cleanup();
    throw error;
  }
}

function readAttachmentGlyph(page: import("@playwright/test").Page) {
  return async () => (await readComposerControlTone(composerControl(page, ATTACH))).glyph;
}

test.describe("Composer toolbar glyph tone", () => {
  test.describe.configure({ timeout: 180_000 });

  test.describe("on a touch screen", () => {
    test.use({ hasTouch: true, viewport: { width: 1024, height: 1366 } });

    test("paints labelled and icon-only actions with their layout tones", async ({ page }) => {
      const agent = await openSeededComposer(page, "composer-tone-touch-");
      try {
        const selection = await readComposerControlTone(
          composerControl(page, USES_CLISBOT_PICKER ? MODEL_CHIP : THINKING),
        );
        const mode = await readComposerControlTone(composerControl(page, MODE));
        const attach = await readComposerControlTone(composerControl(page, ATTACH));

        expectGlyphMatchesLabel(selection, "model or thinking selection");
        expectGlyphMatchesLabel(mode, "mode");
        expectIconOnlyGlyph(attach, "attach");
        if (USES_CLISBOT_PICKER) {
          expect(attach.glyph, "the chat paperclip and model label share their resting tone").toBe(
            selection.label,
          );
        } else {
          expect(attach.glyph, "an icon-only glyph is brighter than a labelled glyph").not.toBe(
            selection.label,
          );
        }
      } finally {
        await agent.cleanup();
      }
    });
  });

  test.describe("on a compact non-touch window", () => {
    test.use({ hasTouch: false, viewport: { width: 590, height: 844 } });

    test("preserves the compact model, mode and attachment tones", async ({ page }) => {
      const agent = await openSeededComposer(page, "composer-tone-compact-");
      try {
        const selection = await readComposerControlTone(
          composerControl(page, USES_CLISBOT_PICKER ? MODEL_CHIP : THINKING),
        );
        const mode = await readComposerControlTone(composerControl(page, MODE));
        const attach = await readComposerControlTone(composerControl(page, ATTACH));

        expectGlyphMatchesLabel(mode, "mode");
        expectIconOnlyGlyph(attach, "attach");
        if (USES_CLISBOT_PICKER) {
          expectGlyphMatchesLabel(selection, "combined model and effort");
          expect(attach.glyph, "the chat paperclip rests at the model chip tone").toBe(
            selection.label,
          );
          await composerControl(page, ATTACH).hover();
          await expect.poll(readAttachmentGlyph(page)).not.toBe(selection.label);
        } else {
          expectIconOnlyGlyph(selection, "thinking");
          expect(selection.glyph, "the icon-only glyphs share one tone").toBe(attach.glyph);
          expect(selection.glyph, "an icon-only glyph is brighter than a labelled glyph").not.toBe(
            mode.label,
          );
        }
      } finally {
        await agent.cleanup();
      }
    });
  });

  test.describe("on a folded compact non-touch window", () => {
    test.use({ hasTouch: false, colorScheme: "light", viewport: { width: 490, height: 844 } });

    test("the empty composer placeholder is quieter than its labels", async ({ page }) => {
      const agent = await openSeededComposer(
        page,
        "composer-tone-placeholder-",
        USES_CLISBOT_PICKER ? MODEL_CHIP : COMBINED_MODEL,
      );
      try {
        const placeholder = await readComposerPlaceholderTone(composerLocator(page));
        // Clisbot's light theme has a dedicated placeholder token (#a1a1aa).
        expect(placeholder, "the composer paints the light-theme placeholder tone").toBe(
          "rgb(161, 161, 170)",
        );
        if (USES_CLISBOT_PICKER) {
          const chip = composerControl(page, MODEL_CHIP);
          await expect(chip).toHaveAccessibleName(/Ten second stream.*Low/i);
          const { label } = await readComposerControlTone(chip);
          expect(label).not.toBeNull();
          expect(
            placeholder,
            "the placeholder stays distinct from the compact model and effort label",
          ).not.toBe(label);
          return;
        }
        const extraMuted = await readComposerTextTone(
          composerControl(page, "combined-model-selector-thinking-label"),
        );
        const muted = await readComposerTextTone(
          composerControl(page, "combined-model-selector-model-label"),
        );

        expect(extraMuted, "the folded thinking label paints the extra-muted tone").not.toBeNull();
        expect(placeholder, "the placeholder stays distinct from the effort label").not.toBe(
          extraMuted,
        );
        expect(placeholder, "the placeholder is quieter than a labelled glyph").not.toBe(muted);
      } finally {
        await agent.cleanup();
      }
    });
  });

  test.describe("with a wide pointer", () => {
    test.use({ hasTouch: false, viewport: { width: 1280, height: 800 } });

    test("a labelled glyph stays muted and matches its label", async ({ page }) => {
      const agent = await openSeededComposer(page, "composer-tone-pointer-");
      try {
        const selection = await readComposerControlTone(
          composerControl(page, USES_CLISBOT_PICKER ? MODEL_CHIP : THINKING),
        );
        const mode = await readComposerControlTone(composerControl(page, MODE));

        expectGlyphMatchesLabel(selection, "model or thinking selection");
        expectGlyphMatchesLabel(mode, "mode");
      } finally {
        await agent.cleanup();
      }
    });
  });
});
