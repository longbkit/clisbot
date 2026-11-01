import { expect, test } from "../support/fixtures";
import {
  applyProfileFromPicker,
  closeModelPicker,
  expectComposerDoesNotName,
  expectAgentProfilesEmptyPrompt,
  expectProfileEditTooltip,
  expectComposerMode,
  expectCreateProfileFromModelRow,
  expectComposerModel,
  expectModelRowProfileActionBesideRow,
  expectModelRowSelected,
  expectProfileEditIsPencilOnly,
  expectProfileVisibleForProvider,
  openModelPicker,
  openAgentProfilesFromEmptyPrompt,
  seedAgentProfiles,
  selectModelRow,
} from "../support/helpers/agent-profiles";
import { expectWorkspaceAgentConfiguration } from "../support/helpers/command-center-agent-controls";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const PROFILE = {
  id: "agent_profile_e2e_ui_work",
  name: "UI work",
  icon: "🎨",
  provider: "mock",
  model: "one-minute-stream",
  modeId: "approval-test",
  notes: "Use for UI work.",
};

const PROFILE_SUMMARY = "Mock Load Test · One minute stream · Approval test";

test.describe("Agent profiles in the model picker", () => {
  test("an empty host still exposes agent profile settings from the picker", async ({ page }) => {
    const seed = await seedAgentProfiles([]);
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "agent-profiles-empty-",
      title: "Agent profiles empty",
    });

    try {
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await openModelPicker(page);
      await expectAgentProfilesEmptyPrompt(page);
      await openAgentProfilesFromEmptyPrompt(page);
    } finally {
      await workspace.cleanup();
      await seed.restore();
    }
  });

  test("applying a pinned profile materializes it into the composer and is then forgotten", async ({
    page,
  }) => {
    const seed = await seedAgentProfiles([PROFILE]);
    // A live agent is one provider's process, so the profile has to name that
    // same provider or the picker will not offer it at all.
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "agent-profiles-picker-",
      title: "Agent profiles picker",
      model: "ten-second-stream",
      modeId: "load-test",
    });

    try {
      await test.step("the agent starts on its seeded model and mode", async () => {
        await openAgentRoute(page, workspace);
        await expectComposerVisible(page);
        await expectComposerModel(page, "Ten second stream");
        await expectComposerMode(page, "Load test");
      });

      await test.step("the panel opens on the agent's provider, its profile one press away", async () => {
        await openModelPicker(page);
        await expect(page.getByTestId("composer-picker-provider-header")).toContainText(
          "Mock Load Test",
        );
        await expectProfileVisibleForProvider(page, {
          name: PROFILE.name,
          summary: PROFILE_SUMMARY,
        });
        await expectProfileEditIsPencilOnly(page);
        await expectProfileEditTooltip(page);
      });

      await test.step("applying it writes its model and mode into the composer", async () => {
        await applyProfileFromPicker(page, PROFILE.name);
        await expectComposerModel(page, "One minute stream");
        await expectComposerMode(page, "Approval test");
        await expectWorkspaceAgentConfiguration(workspace, {
          id: workspace.agentId,
          provider: "mock",
          model: "one-minute-stream",
          modeId: "approval-test",
        });
      });

      await test.step("the composer names the model, never the profile", async () => {
        await expectComposerDoesNotName(page, PROFILE.name);
      });

      await test.step("reopening returns to the provider's models", async () => {
        await openModelPicker(page);
        await expectModelRowSelected(page, {
          provider: "mock",
          modelId: "one-minute-stream",
          modelLabel: "One minute stream",
        });
        await expectProfileVisibleForProvider(page, {
          name: PROFILE.name,
          summary: PROFILE_SUMMARY,
        });
        await closeModelPicker(page);
      });
    } finally {
      await workspace.cleanup();
      await seed.restore();
    }
  });

  test("a model row and its create-profile action are separate buttons", async ({ page }) => {
    const seed = await seedAgentProfiles([]);
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "agent-profiles-row-action-",
      title: "Agent profiles row action",
      model: "ten-second-stream",
      modeId: "load-test",
    });

    try {
      const oneMinute = {
        provider: "mock",
        modelId: "one-minute-stream",
        modelLabel: "One minute stream",
      };
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await openModelPicker(page);
      await expectModelRowProfileActionBesideRow(page, oneMinute);
      await expectCreateProfileFromModelRow(page, oneMinute);
      await expectComposerModel(page, "Ten second stream");
      await openModelPicker(page);
      await selectModelRow(page, oneMinute);
      await expectComposerModel(page, oneMinute.modelLabel);
    } finally {
      await workspace.cleanup();
      await seed.restore();
    }
  });
});
