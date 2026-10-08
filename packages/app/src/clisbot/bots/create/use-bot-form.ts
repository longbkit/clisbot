import { useFormLifetime } from "./use-form-lifetime";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { BotPayload } from "../data/contracts";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { mergeCreateAgentSelectionPreferences } from "@/create-agent-preferences/preferences";
import { refreshBotsAndChats } from "../data/runtime";
import {
  openBotForm,
  toCreateRequest,
  toUpdateRequest,
  type BotFormState,
  type BotFromProject,
} from "./bot-form-model";
import { useBotTemplatePreview } from "./use-bot-template-preview";
import { useBotProviderSnapshot } from "./use-bot-provider-snapshot";
export interface BotCreateFormProps {
  name: string;
  defaultServerId?: string;
  bot?: BotPayload;
  /** Make the bot from this existing Project: it works there and shares it. */
  project?: BotFromProject;
  hosts: { serverId: string; label: string }[];
  onCreated: (serverId: string, botId: string) => void;
  onCancel: () => void;
}
export function useBotForm({
  name,
  defaultServerId,
  bot,
  project,
  hosts,
  onCreated,
}: BotCreateFormProps) {
  const isCurrent = useFormLifetime();
  const { t } = useTranslation();
  const { preferences, updatePreferences } = useFormPreferences();
  const [model] = useState(() =>
    openBotForm({
      mode: bot ? "edit" : "create",
      bot,
      hosts,
      defaults: {
        name,
        preferences,
        ...(defaultServerId ? { serverId: defaultServerId } : {}),
        ...(project ? { project } : {}),
      },
    }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const providerSnapshot = useBotProviderSnapshot(model, state, bot?.cwd ?? project?.path);
  useBotTemplatePreview(model, state);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => model.close(), [model]);
  useEffect(() => model.applyHosts(hosts), [hosts, model]);
  useEffect(() => model.applyPreferences(preferences), [preferences, model]);
  const submit = useCallback(async () => {
    setBusy(true);
    model.setSubmitError(null);
    try {
      const { serverId, ...request } = toCreateRequest(state);
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client || getHostRuntimeStore().getSnapshot(serverId)?.connectionStatus !== "online")
        throw new Error(t("bots.workspace.errors.hostDisconnected"));
      const { serverId: _serverId, ...update } = toUpdateRequest(state, bot?.id ?? "");
      const result = bot ? await client.updateBot(update) : await client.createBot(request);
      if (result.error || !result.bot)
        throw new Error(result.error ?? t("bots.workspace.errors.createBotFailed"));
      refreshBotsAndChats();
      if (!bot && model.isProviderChosen()) void rememberSelection(state, updatePreferences);
      if (isCurrent()) onCreated(serverId, result.bot.id);
    } catch (error) {
      if (isCurrent()) model.setSubmitError(String(error));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [state, model, onCreated, bot, isCurrent, updatePreferences, t]);
  const submitAction = useCallback(() => {
    if (state.canSubmit && !busy) void submit();
  }, [submit, state.canSubmit, busy]);
  return { model, state, providerSnapshot, busy, submitAction };
}

/**
 * A created bot's AI choices become where the next New bot starts, through the same stored
 * preferences New agent uses. A failed write only loses the hint.
 */
function rememberSelection(
  state: BotFormState,
  update: ReturnType<typeof useFormPreferences>["updatePreferences"],
): Promise<unknown> {
  return update((current) =>
    mergeCreateAgentSelectionPreferences({
      preferences: current,
      provider: state.selectedProvider,
      modelId: state.selectedModel,
      modeId: state.selectedMode,
      thinkingOptionId: state.selectedThinkingOptionId,
    }),
  ).catch(() => undefined);
}
