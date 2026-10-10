import { useLocalDay } from "./use-local-day";
import { useCallback } from "react";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useHosts } from "@/runtime/host-runtime";
import { StyleSheet } from "react-native-unistyles";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { rememberChatReturn } from "./mobile-navigation";
import { activitySections } from "./activity";
import { ActivityRow } from "./activity-row";
import { SectionLink } from "./section-link";
/** Home's view of Inbox: the same groups and rows, a few per group. */
export function HomeActivity() {
  useLocalDay();
  const { agents, isInitialLoad } = useAggregatedAgents();
  const showHost = useHosts().length > 1;
  const router = useRouter();
  const openAgent = useCallback((row: AggregatedAgent) => {
    rememberChatReturn("/open-project");
    navigateToAgent({
      serverId: row.serverId,
      agentId: row.id,
      workspaceId: row.workspaceId,
      pin: true,
    });
  }, []);
  const openInbox = useCallback(() => router.navigate("/sessions"), [router]);
  const sections = activitySections(agents, new Date(), 3);
  return (
    <View style={styles.container}>
      {isInitialLoad ? <Text style={styles.muted}>Loading activity…</Text> : null}
      {!isInitialLoad && !agents.length ? (
        <Text style={styles.muted}>Your conversations will appear here.</Text>
      ) : null}
      {sections.map((section) => (
        <View key={section.key} style={section.key === "recent" ? null : styles.section}>
          {section.key.startsWith("date:") ? (
            <Text style={styles.subheading}>{section.title}</Text>
          ) : (
            <SectionLink
              title={section.title}
              count={section.key === "needs" ? section.agents.length : undefined}
              accessibilityLabel={`${section.title}, open Inbox`}
              onPress={openInbox}
            />
          )}
          {section.agents.map((agent) => (
            <ActivityRow
              key={`${agent.serverId}:${agent.id}`}
              agent={agent}
              showHost={showHost}
              onPress={openAgent}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create((t) => ({
  container: {
    gap: t.spacing[4],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[4],
  },
  section: { gap: t.spacing[1] },
  subheading: {
    color: t.colors.foregroundMuted,
    fontSize: t.fontSize.sm,
    marginTop: t.spacing[1],
  },
  muted: { color: t.colors.foregroundMuted, fontSize: t.fontSize.sm },
}));
