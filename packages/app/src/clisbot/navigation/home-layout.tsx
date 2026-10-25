import { useMemo, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { activityKey } from "@/clisbot/home/activity-layout";
import { HomeActivityProvider } from "@/clisbot/home/activity-state";
import type { ActivityBucketOf } from "@/clisbot/home/activity";
import { RenderProfile } from "@/utils/render-profiler";
import { ActivityScrollView, ActivityViewportProvider } from "@/clisbot/home/activity-viewport";
import { StartStatus } from "@/clisbot/home/start-surface";
import { ComposerPickerPlacementProvider } from "@/composer/picker-placement";
import { InboxHistory } from "@/screens/sessions-screen";
import { useNavigationActivity } from "./activity";
import { HomeConnectionNotice } from "./connection-notice";
import { HomeFeedControls } from "./home-controls";
import { buildHomeFeed, type HomeRow } from "./home-feed";
import { NavigationHomeFeed } from "./home-feed-view";
import { useNavigationStore } from "./store";

interface HomeLayoutProps {
  compact: boolean;
  choices: ReactNode;
  form: ReactNode;
  composer: ReactElement;
  quickStarts: ReactNode;
  serverId: string;
  onImportSession?: () => void;
}

/**
 * Home in Navigation V2 (brief C6, 3.1 order): composer → quick starts → scope → chips → Host
 * filter → pins → feed. Hosts live on the rail and in More; a problem shows as one line on top.
 * 🔍 swaps the feed for Inbox's full history and search.
 */
export function NavigationHomeLayout(props: HomeLayoutProps) {
  const { rows } = useNavigationActivity();
  const scope = useNavigationStore((state) => state.scopes.home);
  const mode = useNavigationStore((state) => state.homeMode);
  const chip = useNavigationStore((state) => state.homeChip);
  const serverIds = useNavigationStore((state) => state.homeHosts);
  const searchOpen = useNavigationStore((state) => state.homeSearchOpen);
  const feed = useMemo(
    () => buildHomeFeed(rows, { scope, mode, chip, serverIds }),
    [rows, scope, mode, chip, serverIds],
  );
  const { agents, bucketOf, byKey } = useMemo(() => {
    const buckets = new Map(
      feed.visible.map(({ row, bucket }) => [activityKey(row.agent), bucket]),
    );
    const of: ActivityBucketOf = (agent) => buckets.get(activityKey(agent)) ?? "recent";
    return {
      agents: feed.visible.map(({ row }) => row.agent),
      bucketOf: of,
      byKey: new Map<string, HomeRow>(feed.visible.map(({ row }) => [activityKey(row.agent), row])),
    };
  }, [feed.visible]);
  if (searchOpen) return <InboxHistory />;
  return (
    <RenderProfile id="NavHome">
      <ActivityViewportProvider>
        <HomeActivityProvider agents={agents} bucketOf={bucketOf}>
          <ActivityScrollView
            testID="home-scroll"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scroll}
          >
            <View style={styles.column}>
              <HomeConnectionNotice />
              <StartBlock {...props} />
              <HomeFeedControls scopeCounts={feed.scopeCounts} chipCounts={feed.chipCounts} />
              <NavigationHomeFeed
                rows={byKey}
                filterKey={`${scope}|${mode}|${chip}|${serverIds.join(",")}`}
              />
            </View>
          </ActivityScrollView>
        </HomeActivityProvider>
      </ActivityViewportProvider>
    </RenderProfile>
  );
}

/** The composer near the top, its pickers opening downward, then Status and quick starts. */
function StartBlock({
  compact,
  choices,
  form,
  composer,
  quickStarts,
  serverId,
  onImportSession,
}: HomeLayoutProps) {
  return (
    <View style={styles.start}>
      <View style={compact ? styles.compactContext : styles.desktopContext}>
        <View style={styles.choices}>{choices}</View>
        <View style={compact ? null : styles.flex}>{form}</View>
      </View>
      <ComposerPickerPlacementProvider value="bottom-start">
        {composer}
      </ComposerPickerPlacementProvider>
      <StartStatus serverId={serverId} onImportSession={onImportSession} />
      {quickStarts}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  scroll: { alignItems: "center", paddingBottom: theme.spacing[6] },
  column: { width: "100%", maxWidth: theme.contentMaxWidth },
  start: { paddingTop: theme.spacing[2] },
  desktopContext: { flexDirection: "row", alignItems: "center" },
  compactContext: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  choices: { paddingLeft: theme.spacing[4], marginBottom: theme.spacing[2] },
}));
