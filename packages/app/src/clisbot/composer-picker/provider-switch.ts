import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getBotIdFromLabels } from "@clisbot/protocol/bots/labels";
import { useToast } from "@/contexts/toast-context";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { useForkAgent } from "@/hooks/use-fork-agent";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";

/**
 * Where a live session's provider switch goes (docs/features/bots-and-chats/README.md, "Switching
 * provider"). A running session is one provider's process, so another provider always means a
 * NEW session that carries this one's conversation; this one stays as it is.
 * - `workspace`: a Work session forks into a draft tab on the new provider (the turn footer's fork).
 * - `chat`: a direct chat's Bot moves to the new provider on the Host (`chat.session.fork`).
 * - `unavailable`: other providers are not offered (a group chat's Bots follow their own launch).
 */
export type ProviderSwitchTarget =
  | { kind: "workspace"; workspaceId?: string | null }
  | { kind: "chat"; chatId: string }
  | { kind: "unavailable" };

interface ProviderSwitchInput {
  serverId: string;
  agentId: string;
  target: ProviderSwitchTarget | undefined;
  /** The provider names the dialog shows. */
  providerLabel: (providerId: string) => string;
}

/**
 * Asks before a provider switch, then forks once: a second pick while one is in flight is
 * ignored, Cancel changes nothing and sends nothing, and a Host that cannot switch says so
 * instead of ignoring the pick. Returns null where other providers are not offered.
 */
export function useProviderSwitch(input: ProviderSwitchInput) {
  const { serverId, agentId, target, providerLabel } = input;
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const chatSupported = useHostFeature(serverId, "chatProviderFork");
  const workSupported = useHostFeature(serverId, "agentForkContext");
  const fork = useForkAgent({ serverId, toast });
  const inFlight = useRef(false);
  const kind = target?.kind;

  const run = useCallback(
    async (provider: string, modelId: string) => {
      if (!target || target.kind === "unavailable") return;
      const supported = target.kind === "chat" ? chatSupported : workSupported;
      if (!supported) {
        toast.error(t("composer.providerSwitch.hostNeedsUpdate"));
        return;
      }
      const agent = useSessionStore.getState().sessions[serverId]?.agents?.get(agentId);
      if (!agent) return;
      const confirmed = await confirmDialog({
        title: t("composer.providerSwitch.title", { provider: providerLabel(provider) }),
        message: t(
          target.kind === "chat"
            ? "composer.providerSwitch.chatMessage"
            : "composer.providerSwitch.workMessage",
          { provider: providerLabel(provider), current: providerLabel(agent.provider) },
        ),
        confirmLabel: t("composer.providerSwitch.confirm"),
        cancelLabel: t("composer.providerSwitch.cancel"),
      });
      if (!confirmed) return;
      if (target.kind === "workspace") {
        const workspaceId = target.workspaceId ?? agent.workspaceId;
        await fork({
          agentId,
          agent,
          workspaceId,
          target: "tab",
          launch: { provider, model: modelId },
        });
        return;
      }
      const botId = getBotIdFromLabels(agent.labels);
      if (!client || !botId) throw new Error(t("composer.providerSwitch.failed"));
      const result = await client.forkChatSession({
        chatId: target.chatId,
        botId,
        launch: { provider, model: modelId },
        expectedAgentId: agentId,
      });
      if (result.error) throw new Error(result.error);
    },
    [
      agentId,
      chatSupported,
      client,
      fork,
      providerLabel,
      serverId,
      t,
      target,
      toast,
      workSupported,
    ],
  );

  const switchProvider = useCallback(
    (provider: string, modelId: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      run(provider, modelId)
        .catch((error: unknown) =>
          toast.error(toErrorMessage(error) || t("composer.providerSwitch.failed")),
        )
        .finally(() => {
          inFlight.current = false;
        });
    },
    [run, t, toast],
  );

  return kind && kind !== "unavailable" ? switchProvider : null;
}

/**
 * The picker's providers for a live session: its own first, unchanged, then the others marked as
 * a new session (`tag`), so the in-place choice reads as the main one.
 */
export function withSwitchProviders(
  own: readonly ProviderSelectorProvider[],
  all: readonly ProviderSelectorProvider[],
  ownProviderId: string | undefined,
  tag: string,
): ProviderSelectorProvider[] {
  const others = all
    .filter((provider) => provider.id !== ownProviderId)
    .map(
      (provider): ProviderSelectorProvider => ({
        id: provider.id,
        label: `${provider.label} · ${tag}`,
        modelSelection: provider.modelSelection,
      }),
    );
  return [...own, ...others];
}

/**
 * A live session's model picker: its own provider's models, and where a switch is offered the
 * other providers after them. Picking its own provider changes the model in place; another one
 * goes through `useProviderSwitch`.
 */
export function useLiveProviderChoices(input: {
  serverId: string;
  agentId: string;
  target: ProviderSwitchTarget | undefined;
  entries: ProviderSnapshotEntry[] | undefined;
  ownProviders: ProviderSelectorProvider[];
  ownProviderId: string | undefined;
  selectModel: (modelId: string) => unknown;
}) {
  const { entries, ownProviders, ownProviderId, selectModel } = input;
  const { t } = useTranslation();
  const providerLabel = useCallback(
    (id: string) => entries?.find((entry) => entry.provider === id)?.label ?? id,
    [entries],
  );
  const switchProvider = useProviderSwitch({
    serverId: input.serverId,
    agentId: input.agentId,
    target: input.target,
    providerLabel,
  });
  const providers = useMemo(
    () =>
      switchProvider
        ? withSwitchProviders(
            ownProviders,
            buildSelectableProviderSelectorProviders(entries),
            ownProviderId,
            t("composer.providerSwitch.newSessionTag"),
          )
        : ownProviders,
    [entries, ownProviderId, ownProviders, switchProvider, t],
  );
  const selectProviderAndModel = useCallback(
    (provider: string, modelId: string) => {
      if (provider === ownProviderId || !switchProvider) {
        void selectModel(modelId);
        return;
      }
      switchProvider(provider, modelId);
    },
    [ownProviderId, selectModel, switchProvider],
  );
  return { providers, selectProviderAndModel };
}
