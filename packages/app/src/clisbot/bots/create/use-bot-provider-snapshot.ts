import { useCallback, useEffect } from "react";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { BotFormModel, BotFormState } from "./bot-form-model";

/** Use the same hydrated, push-updated catalog as the workspace and schedule forms. */
export function useBotProviderSnapshot(model: BotFormModel, state: BotFormState, cwd?: string) {
  const serverId = state.selectedServerId;
  const snapshot = useProvidersSnapshot(serverId, { cwd, enabled: Boolean(serverId) });
  useEffect(() => {
    if (serverId && snapshot.entries) {
      model.applyProviderSnapshot(serverId, { entries: snapshot.entries });
    }
  }, [model, serverId, snapshot.entries]);
  const { refetchIfStale, refresh } = snapshot;
  const onOpen = useCallback(() => {
    refetchIfStale(state.selectedProvider);
  }, [refetchIfStale, state.selectedProvider]);
  const onRetryProvider = useCallback(
    (provider: AgentProvider) => {
      void refresh([provider]).catch((error) => model.setSubmitError(String(error)));
    },
    [model, refresh],
  );
  return { ...snapshot, onOpen, onRetryProvider };
}
