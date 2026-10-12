import { useLocalDay } from "./use-local-day";
import { useCallback, useState } from "react";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useHosts } from "@/runtime/host-runtime";
import { StyleSheet } from "react-native-unistyles";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { rememberChatReturn } from "./mobile-navigation";
import { activityBucket, activitySections } from "./activity";
import { Button } from "@/components/ui/button";
import { ActivityRow } from "./activity-row";
import { SectionLink } from "./section-link";
/** Home's view of Inbox: the same groups and rows, a few per group. */
export function HomeActivity() {
  const [limit, setLimit] = useState(10);
  const showMore = useCallback(() => setLimit((current) => current + 10), []);
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
  const sections = activitySections(agents, new Date(), limit);
  const hasMore =
    sections.reduce((count, section) => count + section.agents.length, 0) < agents.length;
  return (
    <View style={styles.container} testID="home-activity">
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
              count={
                section.key === "needs"
                  ? agents.filter((agent) => activityBucket(agent) === "needs").length
                  : undefined
              }
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
      {hasMore ? (
        <Button variant="ghost" onPress={showMore}>
          Show more
        </Button>
      ) : null}
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
