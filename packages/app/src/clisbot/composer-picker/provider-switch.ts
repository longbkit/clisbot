import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getBotIdFromLabels } from "@clisbot/protocol/bots/labels";
import { FULL_AUTO_ACCEPT_MODE_ID } from "@clisbot/protocol/full-auto-accept";
import { useToast } from "@/contexts/toast-context";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { useForkAgent } from "@/hooks/use-fork-agent";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { isProviderAutoAcceptOn, resolveAgentModes, resolveComposerModeId } from "./mode-options";
import {
  permissionScopeOf,
  resolvePermissionCarry,
  type PermissionOption,
} from "./permission-carry";
import { resolveModeLabelKey } from "./mode-options";
import { ProviderSwitchReview, type ProviderSwitchReviewInput } from "./provider-switch-review";
import { useFullAutoAcceptOffered } from "./use-draft-mode-control";

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
  /** The Host's providers: labels, models and the modes each one reports. */
  entries: ProviderSnapshotEntry[] | undefined;
}

/** A provider's mode family: a custom provider reads as the built-in it extends. */
function familyOf(entries: ProviderSnapshotEntry[] | undefined, provider: string): string {
  return entries?.find((entry) => entry.provider === provider)?.baseProvider ?? provider;
}

function describe(
  entries: ProviderSnapshotEntry[] | undefined,
  provider: string,
  model?: string | null,
) {
  const entry = entries?.find((candidate) => candidate.provider === provider);
  const modelLabel = entry?.models?.find((candidate) => candidate.id === model)?.label ?? model;
  const label = entry?.label ?? provider;
  return modelLabel ? `${label} · ${modelLabel}` : label;
}

/**
 * The review for one switch: what the session runs in now (Full auto-accept when it is on, the
 * mode the provider reports otherwise) carried to the target's Host-reported modes.
 */
export function buildSwitchReview(input: {
  agent: Pick<
    Agent,
    | "provider"
    | "model"
    | "currentModeId"
    | "fullAutoAccept"
    | "features"
    | "availableModes"
    | "runtimeInfo"
  >;
  entries: ProviderSnapshotEntry[] | undefined;
  provider: string;
  modelId: string;
  fullAutoAcceptSupported: boolean;
  history: "chat" | "work";
}): ProviderSwitchReviewInput {
  const { agent, entries, provider } = input;
  const sourceEntry = entries?.find((entry) => entry.provider === agent.provider);
  const providerAutoAccept =
    input.fullAutoAcceptSupported && isProviderAutoAcceptOn(agent.features);
  const sourceModeId = resolveComposerModeId(
    agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    input.fullAutoAcceptSupported && agent.fullAutoAccept === true,
    providerAutoAccept,
  );
  const sourceFamily = familyOf(entries, agent.provider);
  const sourceModes = resolveAgentModes(agent.availableModes ?? [], sourceEntry?.modes);
  const carry = resolvePermissionCarry({
    sourceFamily,
    sourceModeId,
    sourceModes,
    targetFamily: familyOf(entries, provider),
    targetModes: entries?.find((entry) => entry.provider === provider)?.modes ?? [],
    fullAutoAcceptSupported: input.fullAutoAcceptSupported,
  });
  return {
    from: describe(entries, agent.provider, agent.model ?? agent.runtimeInfo?.model),
    to: describe(entries, provider, input.modelId),
    fromPermission: sourceModeId ? sourceOption(sourceFamily, sourceModeId, sourceModes) : null,
    carry,
    history: input.history,
  };
}

/** The session's current mode as the review names it: the app's label, else the provider's. */
function sourceOption(
  family: string,
  modeId: string,
  modes: readonly { id: string; label: string; isUnattended?: boolean }[],
): PermissionOption {
  const mode = modes.find((entry) => entry.id === modeId);
  return {
    modeId,
    label:
      modeId === FULL_AUTO_ACCEPT_MODE_ID ? "Clisbot Full auto-accept" : (mode?.label ?? modeId),
    labelKey: resolveModeLabelKey(family, modeId),
    scope: permissionScopeOf(family, mode ?? { id: modeId }),
  };
}

interface PendingReview {
  id: number;
  input: ProviderSwitchReviewInput;
  resolve: (option: PermissionOption | null) => void;
}

/**
 * One review at a time: a second request while one is open answers null at once, and closing,
 * cancelling or unmounting answers null. Only Start new session answers with the chosen option.
 */
function useSwitchReview() {
  const [pending, setPending] = useState<PendingReview | null>(null);
  const current = useRef<PendingReview | null>(null);
  const nextId = useRef(0);
  const settle = useCallback((option: PermissionOption | null) => {
    const request = current.current;
    if (!request) return;
    current.current = null;
    setPending(null);
    request.resolve(option);
  }, []);
  useEffect(() => () => settle(null), [settle]);
  const open = useCallback((input: ProviderSwitchReviewInput) => {
    if (current.current) return Promise.resolve(null);
    return new Promise<PermissionOption | null>((resolve) => {
      const request = { id: ++nextId.current, input, resolve };
      current.current = request;
      setPending(request);
    });
  }, []);
  const cancel = useCallback(() => settle(null), [settle]);
  const element = pending
    ? createElement(ProviderSwitchReview, {
        key: pending.id,
        input: pending.input,
        onCancel: cancel,
        onConfirm: settle,
      })
    : null;
  return { open, element };
}

/**
 * Asks before a provider switch, then forks once: a second pick while one is in flight is
 * ignored, Cancel changes nothing and sends nothing, and a Host that cannot switch says so
 * instead of ignoring the pick. Returns null where other providers are not offered.
 */
export function useProviderSwitch(input: ProviderSwitchInput) {
  const { serverId, agentId, target, entries } = input;
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const chatSupported = useHostFeature(serverId, "chatProviderFork");
  const workSupported = useHostFeature(serverId, "agentForkContext");
  const fullAutoAcceptSupported = useFullAutoAcceptOffered(serverId);
  const fork = useForkAgent({ serverId, toast });
  const review = useSwitchReview();
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
      const option = await review.open(
        buildSwitchReview({
          agent,
          entries,
          provider,
          modelId,
          fullAutoAcceptSupported,
          history: target.kind === "chat" ? "chat" : "work",
        }),
      );
      if (!option) return;
      const modeId = option.modeId;
      if (target.kind === "workspace") {
        const workspaceId = target.workspaceId ?? agent.workspaceId;
        const launch = { provider, model: modelId, modeId };
        await fork({ agentId, agent, workspaceId, target: "tab", launch });
        return;
      }
      const botId = getBotIdFromLabels(agent.labels);
      if (!client || !botId) throw new Error(t("composer.providerSwitch.failed"));
      const result = await client.forkChatSession({
        chatId: target.chatId,
        botId,
        launch: { provider, model: modelId, ...(modeId ? { modeId } : {}) },
        expectedAgentId: agentId,
      });
      if (result.error) throw new Error(result.error);
      // The new session reports what it runs in; say so when it is not what was chosen.
      const launched = result.launchedMode;
      if (modeId && launched && launched !== modeId)
        toast.error(t("composer.providerSwitch.modeDiffers", { mode: launched }));
    },
    [
      agentId,
      chatSupported,
      client,
      entries,
      fork,
      fullAutoAcceptSupported,
      review,
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

  return {
    switchProvider: kind && kind !== "unavailable" ? switchProvider : null,
    reviewElement: review.element,
  };
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
  const { switchProvider, reviewElement } = useProviderSwitch({
    serverId: input.serverId,
    agentId: input.agentId,
    target: input.target,
    entries,
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
  return { providers, selectProviderAndModel, reviewElement };
}
