import { useCallback, useMemo, type ReactElement } from "react";
import { StyleSheet } from "react-native-unistyles";
import { useProviderIcon } from "@/components/provider-icons";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { HeartbeatsMenu, type HeartbeatSection } from "./heartbeats-menu";

/**
 * Heartbeats in the workspace header, right after its ⋯. The selected tab's session leads; the
 * workspace's other sessions follow, each a row that jumps to it. The upstream header only hands
 * over which workspace and which agent tab is focused.
 */
export function WorkspaceHeartbeatsButton({
  serverId,
  workspaceId,
  focusedAgentId,
}: {
  serverId: string;
  workspaceId: string;
  focusedAgentId: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const openAgent = useCallback(
    (agentId: string) => navigateToAgent({ serverId, agentId, workspaceId }),
    [serverId, workspaceId],
  );
  const sections = useMemo<HeartbeatSection[]>(() => {
    const inWorkspace = [...(agents?.values() ?? [])].filter(
      (agent) =>
        agent.workspaceId === workspaceId &&
        !agent.archivedAt &&
        agent.labels?.["clisbot.schedule-id"] === undefined,
    );
    const untitled = t("heartbeats.untitledSession");
    const focused = inWorkspace.find((agent) => agent.id === focusedAgentId);
    const current: HeartbeatSection[] = focusedAgentId
      ? [
          {
            key: focusedAgentId,
            title: `${t("heartbeats.thisSession")} · ${focused?.title?.trim() || untitled}`,
            agentIds: [focusedAgentId],
            current: true,
            createAgentId: focusedAgentId,
          },
        ]
      : [];
    const others = inWorkspace
      .filter((agent) => agent.id !== focusedAgentId)
      .map<HeartbeatSection>((agent) => ({
        key: agent.id,
        title: agent.title?.trim() || untitled,
        agentIds: [agent.id],
        current: false,
        onOpen: () => openAgent(agent.id),
        icon: <ProviderIcon provider={agent.provider} serverId={serverId} />,
      }));
    return [...current, ...others];
  }, [agents, focusedAgentId, openAgent, serverId, t, workspaceId]);
  return (
    <HeartbeatsMenu
      serverId={serverId}
      sections={sections}
      emptyHint={t("heartbeats.emptySession")}
      onOpenAgent={openAgent}
      testID="workspace-heartbeats"
    />
  );
}

function ProviderIcon({ provider, serverId }: { provider: string; serverId: string }) {
  const Icon = useProviderIcon(provider, serverId);
  return <Icon size={14} color={styles.icon.color} />;
}

const styles = StyleSheet.create((theme) => ({
  icon: { color: theme.colors.foregroundMuted },
}));
