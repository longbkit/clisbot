import { ActivityPlaceholder } from "./activity-placeholder";
import { DirectoryStatus } from "@/components/directory-status";
import { useCallback } from "react";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { View, Text } from "react-native";
import { useHosts } from "@/runtime/host-runtime";
import { StyleSheet } from "react-native-unistyles";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { rememberChatReturn } from "./mobile-navigation";
import { activityKey, visibleActivityLayout, type ActivityLayoutSection } from "./activity-layout";
import { useHomeActivity } from "./activity-state";
import { ActivityAnchor } from "./activity-viewport";
import { Button } from "@/components/ui/button";
import { ActivityRow } from "./activity-row";
import { SectionLink } from "./section-link";
/** Live row contents in a layout that stays still while the user reads. */
export function HomeActivity() {
  const { agents, isInitialLoad, directoryHealth, accepted, needs, limit, showMore, openInbox } =
    useHomeActivity();
  const showHost = useHosts().length > 1;
  const openAgent = useCallback((row: AggregatedAgent) => {
    rememberChatReturn("/open-project");
    navigateToAgent({
      serverId: row.serverId,
      agentId: row.id,
      workspaceId: row.workspaceId,
      pin: true,
    });
  }, []);
  const sections = visibleActivityLayout(accepted, limit);
  const hasMore =
    sections.reduce((count, section) => count + section.keys.length, 0) <
    accepted.reduce((count, section) => count + section.keys.length, 0);
  const live = new Map(agents.map((agent) => [activityKey(agent), agent]));
  return (
    <View style={styles.container} testID="home-activity">
      <DirectoryStatus health={directoryHealth} label="Activity" inset={false} />
      {isInitialLoad ? <ActivityPlaceholder /> : null}
      {!isInitialLoad && directoryHealth.hasAcceptedResult && !accepted.length ? (
        <Text style={styles.muted}>Your conversations will appear here.</Text>
      ) : null}
      {sections.map((section) => (
        <ActivitySection
          key={section.key}
          section={section}
          live={live}
          needs={needs}
          showHost={showHost}
          onPress={openAgent}
          openInbox={openInbox}
        />
      ))}
      {hasMore ? (
        <Button variant="ghost" onPress={showMore}>
          Show more
        </Button>
      ) : null}
    </View>
  );
}

function ActivitySection({
  section,
  live,
  needs,
  showHost,
  onPress,
  openInbox,
}: {
  section: ActivityLayoutSection;
  live: Map<string, AggregatedAgent>;
  needs: number;
  showHost: boolean;
  onPress: (agent: AggregatedAgent) => void;
  openInbox: () => void;
}) {
  return (
    <View
      style={section.key === "recent" ? null : styles.section}
      testID={`home-activity-section-${section.key}`}
    >
      {section.key.startsWith("date:") ? (
        <Text style={styles.subheading}>{section.title}</Text>
      ) : (
        <SectionLink
          title={section.title}
          count={section.key === "needs" ? needs : undefined}
          accessibilityLabel={`${section.title}, open Inbox`}
          onPress={openInbox}
        />
      )}
      {section.keys.map((key) => {
        const agent = live.get(key);
        return (
          <ActivityAnchor key={key} identity={key}>
            {agent ? (
              <ActivityRow
                agent={agent}
                homeBucket={section.key}
                showHost={showHost}
                onPress={onPress}
              />
            ) : (
              <Text style={styles.muted}>Conversation unavailable</Text>
            )}
          </ActivityAnchor>
        );
      })}
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
