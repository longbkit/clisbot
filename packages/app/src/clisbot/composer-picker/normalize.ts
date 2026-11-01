import type { AgentFeature, AgentMode, AgentSelectOption } from "@clisbot/protocol/agent-types";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import {
  buildComposerModeOptions,
  isProviderAutoAcceptOn,
  resolveComposerModeId,
  resolveModeConcept,
} from "./mode-options";
import type { ReasoningOption } from "./reasoning-column";
import { resolvePanelFeatures, type SpeedControl } from "./speed";

/**
 * The one place that turns a provider's native modes, efforts and features into the composer's
 * concepts: a Mode list (permissions, Plan, then Full auto-accept), Reasoning, Standard | Fast,
 * and Other options. UI components read only this shape; every provider difference lives in
 * `mode-options.ts`, `speed.ts` and here. The daemon has already marked each provider's
 * no-prompt mode (`provider-modes.ts`), so this reads `isUnattended` rather than provider ids.
 */
export interface ComposerOptionsInput {
  provider: string;
  modes: readonly AgentMode[];
  currentModeId: string | null | undefined;
  /** The agent's Full auto-accept flag; undefined for a draft. */
  fullAutoAccept?: boolean;
  fullAutoAcceptSupported: boolean;
  model: { thinkingOptions?: AgentSelectOption[]; defaultThinkingOptionId?: string } | null;
  features: readonly AgentFeature[];
}

export interface ComposerOptions {
  modes: AgentMode[];
  selectedModeId: string | null;
  /** Plan's id when the provider plans, wherever it sits in the native list. */
  planModeId: string | null;
  /** The provider mode Full auto-accept runs on, chosen as the daemon chooses it. */
  fullAutoAcceptRunsOn: string | null;
  reasoning: { options: ReasoningOption[]; defaultId: string | undefined };
  speed: SpeedControl | null;
  more: AgentFeature[];
}

export function resolveFullAutoAcceptRunsOn(
  modes: readonly AgentMode[],
  currentModeId: string | null | undefined,
): string | null {
  return modes.find((mode) => mode.isUnattended === true)?.id ?? currentModeId ?? null;
}

export function normalizeReasoning(
  model: ComposerOptionsInput["model"],
): ComposerOptions["reasoning"] {
  const options = (model?.thinkingOptions ?? []).map((option) => ({
    id: option.id,
    label: formatThinkingOptionLabel(option),
    isDefault: option.isDefault === true || option.id === model?.defaultThinkingOptionId,
  }));
  return { options, defaultId: options.find((option) => option.isDefault)?.id };
}

export function normalizeComposerOptions(input: ComposerOptionsInput): ComposerOptions {
  const panel = resolvePanelFeatures(input.features, {
    fullAutoAcceptSupported: input.fullAutoAcceptSupported,
  });
  const plan = input.modes.find((mode) => resolveModeConcept(input.provider, mode) === "plan");
  return {
    modes: buildComposerModeOptions(input.modes, input.fullAutoAcceptSupported),
    selectedModeId: resolveComposerModeId(
      input.currentModeId,
      input.fullAutoAccept,
      input.fullAutoAcceptSupported && isProviderAutoAcceptOn(input.features),
    ),
    planModeId: plan?.id ?? null,
    fullAutoAcceptRunsOn: resolveFullAutoAcceptRunsOn(input.modes, input.currentModeId),
    reasoning: normalizeReasoning(input.model),
    speed: panel.speed,
    more: panel.more,
  };
}
