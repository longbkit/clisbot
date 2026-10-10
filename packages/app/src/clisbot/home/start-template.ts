import type { BotLaunchDefaults } from "@clisbot/protocol/bots/types";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import type { QuickStartInput, QuickStartTarget } from "@clisbot/protocol/quick-starts/types";
import type { PickerItem } from "@/screens/new-workspace-picker-item";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import type { useAgentInputDraft } from "@/composer/draft/input-draft";
export type StartComposer = NonNullable<ReturnType<typeof useAgentInputDraft>["composerState"]>;
export function composerLaunch(composer: StartComposer): BotLaunchDefaults {
  if (!composer.selectedProvider) throw new Error("Select an available provider.");
  return {
    provider: composer.selectedProvider,
    model: composer.effectiveModelId || undefined,
    modeId: composer.selectedMode || undefined,
    thinkingOptionId: composer.effectiveThinkingOptionId || undefined,
    featureValues: composer.featureValues,
  };
}
export function snapshotStart(
  target: QuickStartTarget,
  prompt: string,
  composer: StartComposer | null,
  isolation: string,
  item: PickerItem | null,
): QuickStartInput {
  if (target.kind === "project") {
    let workspace: typeof target.workspace = { kind: "local" };
    if (isolation === "worktree") {
      let base: Extract<typeof target.workspace, { kind: "worktree" }>["base"] = {
        kind: "default",
      };
      if (item?.kind === "branch") base = { kind: "ref", refName: item.refName };
      else if (item?.kind === "github-pr") base = { kind: "ask" };
      workspace = { kind: "worktree", base };
    }
    target = { ...target, workspace };
  }
  return {
    name: "",
    visibility: "personal",
    target,
    startingPrompt: prompt,
    agent: composer?.selectedProvider
      ? { kind: "configured", config: composerLaunch(composer) }
      : { kind: "default" },
  };
}
export function templateConfigProblem(
  config: BotLaunchDefaults,
  entries: ProviderSnapshotEntry[],
): string | null {
  const provider = entries.find((entry) => entry.provider === config.provider);
  if (!provider?.enabled || provider.status !== "ready")
    return `Provider ${config.provider} is unavailable.`;
  const model = config.model
    ? provider.models?.find((entry) => entry.id === config.model)
    : (provider.models?.find((entry) => entry.isDefault) ?? provider.models?.[0]);
  if (config.model && !model) return `Model ${config.model} is unavailable on this Host.`;
  if (config.modeId && !provider.modes?.some((mode) => mode.id === config.modeId))
    return `Permission mode ${config.modeId} is unavailable.`;
  if (
    config.thinkingOptionId &&
    !model?.thinkingOptions?.some((option) => option.id === config.thinkingOptionId)
  )
    return `Effort ${config.thinkingOptionId} is unavailable for this model.`;
  return null;
}
export function defaultStartLaunch(
  preferences: FormPreferences,
  composer: StartComposer,
): BotLaunchDefaults | null {
  const provider = preferences.provider ?? composer.selectedProvider;
  if (!provider) return null;
  const pref = preferences.providerPreferences?.[provider];
  return {
    provider,
    model: pref?.model,
    modeId: pref?.mode,
    thinkingOptionId: pref?.thinkingByModel?.[pref?.model ?? ""],
    featureValues: pref?.featureValues,
  };
}
export function applyLaunch(composer: StartComposer, config: BotLaunchDefaults) {
  composer.applyProfileFromUser({
    provider: config.provider,
    modelId: config.model ?? "",
    modeId: config.modeId ?? "",
    thinkingOptionId: config.thinkingOptionId ?? "",
    featureValues: config.featureValues ?? {},
  });
}
