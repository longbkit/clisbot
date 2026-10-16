import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AGENT_LIFECYCLE_STATUSES,
  type AgentLifecycleStatus,
} from "@clisbot/protocol/agent-lifecycle";
import { type SidebarStateBucket, deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { STATUS_INDICATOR_FILLED_DOT_SIZE } from "@/utils/status-indicator-geometry";

export function AgentStatusDot({
  status,
  requiresAttention,
  attentionReason,
  pendingPermissionCount,
  showInactive = false,
}: {
  status: string | null | undefined;
  requiresAttention: boolean | null | undefined;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissionCount?: number;
  showInactive?: boolean;
}) {
  if (!status) {
    return null;
  }
  if (!isAgentLifecycleStatus(status)) {
    return null;
  }

  const bucket = deriveSidebarStateBucket({
    status,
    requiresAttention: Boolean(requiresAttention),
    attentionReason: attentionReason ?? null,
    pendingPermissionCount: pendingPermissionCount ?? 0,
  });
  return <SidebarStatusDot bucket={bucket} showInactive={showInactive} />;
}

/** Shared bucket colors; no dot means no outstanding session state. */
export function SidebarStatusDot({
  bucket,
  showInactive = false,
}: {
  bucket: SidebarStateBucket;
  showInactive?: boolean;
}) {
  if (bucket === "done" && !showInactive) return null;
  return <View style={styles.dot(bucket)} />;
}

function isAgentLifecycleStatus(value: string): value is AgentLifecycleStatus {
  return AGENT_LIFECYCLE_STATUSES.some((status) => status === value);
}

const styles = StyleSheet.create((theme) => ({
  dot: (bucket: SidebarStateBucket) => ({
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: getStatusDotColor({ theme, bucket, showDoneAsInactive: true }) ?? undefined,
  }),
}));
