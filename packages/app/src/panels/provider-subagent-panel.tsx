import { useCallback, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useShallow } from "zustand/react/shallow";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { sessionStorageReadable } from "@/clisbot/session-storage/capability";
import { AgentStreamView } from "@/agent-stream/view";
import { getProviderIcon } from "@/components/provider-icons";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import { useSubagentTimelineHistory } from "@/subagents/use-subagent-timeline-history";
import {
  providerSubagentKey,
  providerSubagentLifecycleStatus,
  refreshProviderSubagents,
  setProviderSubagentTimelineReading,
  useProviderSubagentStore,
} from "@/subagents/provider-store";
import { useTranslation } from "react-i18next";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { TurnPresentation } from "@/timeline/turn-liveness";

const EMPTY_PERMISSIONS = new Map<string, PendingPermission>();
const EMPTY_STREAM_ITEMS: StreamItem[] = [];

function formatProviderLabel(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function useProviderSubagentDescriptor(
  target: { kind: "provider_subagent"; parentAgentId: string; subagentId: string },
  context: { serverId: string },
): PanelDescriptor {
  const descriptor = useProviderSubagentStore((state) =>
    state.descriptors.get(
      providerSubagentKey(context.serverId, target.parentAgentId, target.subagentId),
    ),
  );
  const parentProvider = useSessionStore(
    (state) => state.sessions[context.serverId]?.agents.get(target.parentAgentId)?.provider,
  );
  const provider = descriptor?.provider ?? parentProvider ?? "agent";
  // The task names the tab; the subagent type is supporting detail beside the provider.
  const subagentType = descriptor?.title?.trim();
  const label = descriptor?.description?.trim() || subagentType || "Subagent";
  const providerLabel = `${formatProviderLabel(provider)} subagent`;
  return {
    label,
    subtitle:
      subagentType && subagentType !== label ? `${subagentType} · ${providerLabel}` : providerLabel,
    tooltip: label,
    titleState: descriptor ? "ready" : "loading",
    icon: getProviderIcon(provider),
    statusBucket: descriptor
      ? deriveSidebarStateBucket({
          status: providerSubagentLifecycleStatus(descriptor.status),
          requiresAttention: descriptor.status === "failed",
        })
      : null,
  };
}

function ProviderSubagentPanel() {
  const { t } = useTranslation();
  const { serverId, target, openFileInWorkspace } = usePaneContext();
  invariant(target.kind === "provider_subagent", "ProviderSubagentPanel requires provider target");
  const key = providerSubagentKey(serverId, target.parentAgentId, target.subagentId);
  const streamId = `provider:${encodeURIComponent(target.parentAgentId)}:${encodeURIComponent(target.subagentId)}`;
  const { descriptor, timeline } = useProviderSubagentStore(
    useShallow((state) => ({
      descriptor: state.descriptors.get(key) ?? null,
      timeline: state.timelines.get(key) ?? null,
    })),
  );
  const parent = useSessionStore(
    (state) =>
      state.sessions[serverId]?.agents.get(target.parentAgentId) ??
      state.sessions[serverId]?.agentDetails.get(target.parentAgentId) ??
      null,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const serverInfo = useSessionStore((state) => state.sessions[serverId]?.serverInfo ?? null);
  // COMPAT(providerSubagents): added in v0.2.11, remove after 2027-01-12.
  const supported = serverInfo?.features?.providerSubagents === true;
  const readable = sessionStorageReadable(serverInfo);
  const isActive = useRetainedPanelActive();
  const history = useSubagentTimelineHistory({
    client,
    serverId,
    parentAgentId: target.parentAgentId,
    subagentId: target.subagentId,
    supported,
    readable,
    isActive,
  });

  useEffect(() => {
    setProviderSubagentTimelineReading(serverId, target.parentAgentId, target.subagentId, isActive);
    return () =>
      setProviderSubagentTimelineReading(serverId, target.parentAgentId, target.subagentId, false);
  }, [serverId, target.parentAgentId, target.subagentId, isActive]);

  const reportReadingPosition = useCallback(
    (rowId: string | null) => {
      setProviderSubagentTimelineReading(
        serverId,
        target.parentAgentId,
        target.subagentId,
        isActive,
        rowId,
      );
    },
    [serverId, target.parentAgentId, target.subagentId, isActive],
  );

  useEffect(() => {
    if (!client || !supported) return;
    void refreshProviderSubagents(client, serverId, target.parentAgentId).catch(() => undefined);
  }, [client, serverId, supported, target.parentAgentId]);

  const subtitle = descriptor?.subtitle?.trim();

  const streamContext = useMemo<AgentScreenAgent>(
    () => ({
      serverId,
      id: streamId,
      provider: descriptor?.provider ?? parent?.provider,
      status: descriptor ? providerSubagentLifecycleStatus(descriptor.status) : "initializing",
      cwd: descriptor?.cwd ?? parent?.cwd ?? "",
      workspaceId: parent?.workspaceId,
      projectPlacement: parent?.projectPlacement,
    }),
    [descriptor, parent, serverId, streamId],
  );
  const turnPresentation = useMemo<TurnPresentation>(
    () => ({
      isActive: descriptor?.status === "running",
      isCancelling: false,
      startedAt: null,
      turnId: null,
    }),
    [descriptor?.status],
  );

  if (serverInfo && !supported) {
    return (
      <View style={styles.unsupported} testID="provider-subagent-panel-unsupported">
        <Text style={styles.unsupportedText}>{t("message.actions.forkUnavailable")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="provider-subagent-panel">
      {subtitle ? (
        <View style={styles.subtitleHeader}>
          <Text
            style={styles.subtitleText}
            numberOfLines={1}
            testID="provider-subagent-pane-subtitle"
          >
            {subtitle}
          </Text>
        </View>
      ) : null}
      {history.historyError || timeline?.error ? (
        <Text style={styles.unsupportedText} accessibilityRole="alert">
          {history.historyError ?? timeline?.error}
        </Text>
      ) : null}
      <AgentStreamView
        agentId={streamId}
        historyAgentId={null}
        timelineAgentId={target.parentAgentId}
        timelineSubagentId={target.subagentId}
        serverId={serverId}
        context={streamContext}
        streamItems={timeline?.tail ?? EMPTY_STREAM_ITEMS}
        streamHead={timeline?.head ?? EMPTY_STREAM_ITEMS}
        turnPresentation={turnPresentation}
        pendingPermissions={EMPTY_PERMISSIONS}
        isAuthoritativeHistoryReady={timeline?.historyReady === true}
        onReadingPositionChange={reportReadingPosition}
        onOpenWorkspaceFile={openFileInWorkspace}
        readOnly
        historyPagination={history}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  subtitleHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  subtitleText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  unsupported: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  unsupportedText: { color: theme.colors.foregroundMuted, textAlign: "center" },
}));

export const providerSubagentPanelRegistration = definePanel("provider_subagent", {
  component: ProviderSubagentPanel,
  useDescriptor: useProviderSubagentDescriptor,
});
