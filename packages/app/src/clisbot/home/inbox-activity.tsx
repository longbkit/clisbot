import type { Theme } from "@/styles/theme";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { WifiOff } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SidebarStatusDot } from "@/components/agent-status-dot";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { getStatusBucketLabel } from "@/hooks/sidebar-status-view-model";
import { HOME_V2_ENABLED } from "./feature";
import { summarizeInboxActivity, type InboxActivity } from "./inbox-activity-model";

const EMPTY: InboxActivity = {
  active: 0,
  needs: 0,
  unread: 0,
  bucket: "done",
  complete: false,
  availability: "loading",
};
const InboxActivityContext = createContext(EMPTY);
export function InboxActivityProvider({ children }: { children: ReactNode }) {
  return HOME_V2_ENABLED ? <ObservedInboxActivity>{children}</ObservedInboxActivity> : children;
}
function ObservedInboxActivity({ children }: { children: ReactNode }) {
  // Lifted from MobileTabBar: one passive observer shared by desktop and compact navigation.
  const { agents, directoryHealth } = useAggregatedAgents({ demand: false });
  const result = useMemo(
    () => summarizeInboxActivity(agents, directoryHealth),
    [agents, directoryHealth],
  );
  const { active, needs, unread, bucket, complete, availability } = result;
  const value = useMemo(
    () => ({ active, needs, unread, bucket, complete, availability }),
    [active, needs, unread, bucket, complete, availability],
  );
  return <InboxActivityContext.Provider value={value}>{children}</InboxActivityContext.Provider>;
}
export function useInboxActivity() {
  return useContext(InboxActivityContext);
}
export function useInboxActivityLabel() {
  const summary = useInboxActivity();
  const { t } = useTranslation();
  const counts = t("inboxActivity.counts", summary);
  const state = summary.bucket !== "done" ? getStatusBucketLabel(summary.bucket, t) : "";
  let availability = "";
  if (summary.availability === "unavailable")
    availability = t(summary.complete ? "inboxActivity.lastKnown" : "inboxActivity.partial");
  else if (!summary.complete) availability = t("inboxActivity.loading");
  return ["Inbox", counts, state, availability].filter(Boolean).join(", ");
}
/** Running count is separate from the existing Needs you badge and unread-reply state. */
export function InboxActivityIndicator() {
  const summary = useInboxActivity();
  const label = useInboxActivityLabel();
  let count = String(summary.active);
  if (!summary.complete) count = summary.active ? `${summary.active}+` : "—";
  return (
    <View style={styles.indicator} accessibilityLabel={label} testID="inbox-activity">
      <SidebarStatusDot bucket={summary.bucket} />
      {summary.availability === "unavailable" ? (
        <ThemedWifiOff size={12} uniProps={offlineColor} />
      ) : null}
      <Text style={styles.count} testID="inbox-active-count">
        {count}
      </Text>
    </View>
  );
}
const ThemedWifiOff = withUnistyles(WifiOff);
const offlineColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const styles = StyleSheet.create((theme) => ({
  indicator: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], flexShrink: 0 },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
}));
