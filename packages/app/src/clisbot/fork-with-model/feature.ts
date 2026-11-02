import { COMPOSER_PICKER_ENABLED } from "@/clisbot/composer-picker/feature";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";

/**
 * Rollback boundary for "Fork with another model…" in the fork menu: a session keeps its
 * provider for life, so switching provider means forking the conversation into a new draft
 * that starts on the chosen model. The menu reuses the composer picker's panel, so it needs
 * that picker on. `EXPO_PUBLIC_CLISBOT_FORK_WITH_MODEL=0` hides the item.
 */
export const FORK_WITH_MODEL_ENABLED =
  COMPOSER_PICKER_ENABLED && process.env.EXPO_PUBLIC_CLISBOT_FORK_WITH_MODEL !== "0";

export interface ForkModelChoice {
  provider: string;
  modelId: string;
}

/**
 * The fork draft's setup on the chosen model. Thinking levels belong to a model, and modes and
 * feature values to a provider, so whatever no longer applies falls back to the defaults.
 */
export function applyForkModelChoice(
  setup: WorkspaceDraftTabSetup,
  choice: ForkModelChoice | undefined,
): WorkspaceDraftTabSetup {
  if (!choice) return setup;
  if (choice.provider === setup.provider) {
    return { ...setup, model: choice.modelId, thinkingOptionId: null };
  }
  return {
    ...setup,
    provider: choice.provider,
    model: choice.modelId,
    modeId: null,
    thinkingOptionId: null,
    featureValues: {},
  };
}
