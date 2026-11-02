import { memo, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { HomeActivityProvider } from "@/clisbot/home/activity-state";
import { ActivityPlaceholder } from "@/clisbot/home/activity-placeholder";
import { RenderProfile } from "@/utils/render-profiler";
import { HoldReadingPosition } from "./hold-reading-position";
import { ActivityScrollView, ActivityViewportProvider } from "@/clisbot/home/activity-viewport";
import { StartStatus } from "@/clisbot/home/start-surface";
import { ComposerPickerPlacementProvider } from "@/composer/picker-placement";
import { InboxHistory } from "@/screens/sessions-screen";
import { useNavigationActivity } from "./activity";
import { HomeConnectionNotice } from "./connection-notice";
import { HomeFeedControls } from "./home-controls";
import { createHomeFeedCache } from "./home-feed";
import { NavigationHomeFeed } from "./home-feed-view";
import { useNavigationStore } from "./store";
import { useHostFilter } from "./host-filter";

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
  const feedReady = useAfterFirstFrame();
  const { rows } = useNavigationActivity();
  const scope = useNavigationStore((state) => state.scopes.home);
  const mode = useNavigationStore((state) => state.homeMode);
  const chip = useNavigationStore((state) => state.homeChip);
  const { serverIds } = useHostFilter();
  const searchOpen = useNavigationStore((state) => state.homeSearchOpen);
  // One pass over the rows; parts that did not change keep their objects, so an update to a
  // session the feed does not show re-renders nothing below.
  const feedOf = useMemo(createHomeFeedCache, []);
  const feed = useMemo(
    () => feedOf(rows, { scope, mode, chip, serverIds }),
    [feedOf, rows, scope, mode, chip, serverIds],
  );
  if (searchOpen) return <InboxHistory />;
  return (
    <RenderProfile id="NavHome">
      <ActivityViewportProvider>
        <HomeActivityProvider agents={feed.agents} bucketOf={feed.bucketOf}>
          <ActivityScrollView
            testID="home-scroll"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scroll}
          >
            <View style={styles.column}>
              {connectionNotice}
              <StartBlock {...props} />
              <HomeFeedControls scopeCounts={feed.scopeCounts} chipCounts={feed.chipCounts} />
              {feedReady ? (
                <NavigationHomeFeed
                  rows={feed.byKey}
                  unseen={feed.unseen}
                  filterKey={`${scope}|${mode}|${chip}|${serverIds.join(",")}`}
                />
              ) : (
                <ActivityPlaceholder />
              )}
            </View>
          </ActivityScrollView>
        </HomeActivityProvider>
      </ActivityViewportProvider>
    </RenderProfile>
  );
}

const connectionNotice = (
  <HoldReadingPosition>
    <HomeConnectionNotice />
  </HoldReadingPosition>
);

/**
 * The composer near the top, its pickers opening downward, then Status and quick starts.
 * Memoized: its props come from Home's parent, so a directory update does not re-render it.
 */
const StartBlock = memo(function StartBlock({
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
});

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  scroll: { alignItems: "center", paddingBottom: theme.spacing[6] },
  column: { width: "100%", maxWidth: theme.contentMaxWidth },
  start: { paddingTop: theme.spacing[2] },
  desktopContext: { flexDirection: "row", alignItems: "center" },
  compactContext: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  choices: { paddingLeft: theme.spacing[4], marginBottom: theme.spacing[2] },
}));

/**
 * Home's header, composer and filters paint in the frame the reader switched in; the feed follows
 * one frame later, so switching to Home is not held up by the longest list on it (acceptance P2).
 */
function useAfterFirstFrame(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return ready;
}
