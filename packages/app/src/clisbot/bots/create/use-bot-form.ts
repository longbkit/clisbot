import { useFormLifetime } from "./use-form-lifetime";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { BotPayload } from "../data/contracts";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { refreshBotsAndChats } from "../data/runtime";
import { openBotForm, toCreateRequest, toUpdateRequest } from "./bot-form-model";
import { useBotProviderSnapshot } from "./use-bot-provider-snapshot";
export interface BotCreateFormProps {
  name: string;
  defaultServerId?: string;
  bot?: BotPayload;
  hosts: { serverId: string; label: string }[];
  onCreated: (serverId: string, botId: string) => void;
  onCancel: () => void;
}
export function useBotForm({ name, defaultServerId, bot, hosts, onCreated }: BotCreateFormProps) {
  const isCurrent = useFormLifetime();
  const { preferences } = useFormPreferences();
  const [model] = useState(() =>
    openBotForm({
      mode: bot ? "edit" : "create",
      bot,
      hosts,
      defaults: {
        name,
        preferences,
        ...(defaultServerId ? { serverId: defaultServerId } : {}),
      },
    }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const providerSnapshot = useBotProviderSnapshot(model, state, bot?.cwd);
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
        throw new Error("Host is disconnected");
      const { serverId: _serverId, ...update } = toUpdateRequest(state, bot?.id ?? "");
      const result = bot ? await client.updateBot(update) : await client.createBot(request);
      if (result.error || !result.bot) throw new Error(result.error ?? "Bot could not be created");
      refreshBotsAndChats();
      if (isCurrent()) onCreated(serverId, result.bot.id);
    } catch (error) {
      if (isCurrent()) model.setSubmitError(String(error));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [state, model, onCreated, bot, isCurrent]);
  const submitAction = useCallback(() => {
    void submit();
  }, [submit]);
  return { model, state, providerSnapshot, busy, submitAction };
}
