import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import equal from "fast-deep-equal";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { ActivityPlaceholder } from "@/clisbot/home/activity-placeholder";
import { ActivityRow } from "@/clisbot/home/activity-row";
import {
  activityKey,
  visibleActivityLayout,
  type ActivityLayoutSection,
} from "@/clisbot/home/activity-layout";
import { useHomeActivity } from "@/clisbot/home/activity-state";
import { ActivityAnchor } from "@/clisbot/home/activity-viewport";
import { rememberChatReturn } from "@/clisbot/home/mobile-navigation";
import { SectionLink } from "@/clisbot/home/section-link";
import { DirectoryStatus } from "@/components/directory-status";
import { Button } from "@/components/ui/button";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useHosts } from "@/runtime/host-runtime";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { CONTROL_HEIGHTS, MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { ICON_SIZE } from "@/styles/theme";
import { useStableEvent } from "@/hooks/use-stable-event";
import { RenderProfile } from "@/utils/render-profiler";
import { HoldReadingPosition } from "./hold-reading-position";
import { useHostsReachability } from "./hosts-status";
import { HostsUnreachableState } from "./hosts-unreachable-state";
import { ListState } from "./list-state";
import { useNavigationActivity } from "./activity";
import type { HomeChip, HomeRow } from "./home-feed";
import { IssueActions } from "./issue-actions";
import { HOME_PATH } from "./sections";
import { useNavigationStore } from "./store";

const SECTION_CHIPS: Record<string, HomeChip> = { needs: "needs", active: "running" };

/**
 * Home's feed (brief C6, C16): Home's stable activity layout over the filtered rows. Issues carry
 * their next steps; seen ones collapse into one Seen issues row at the bottom.
 */
export function NavigationHomeFeed({
  rows,
  filterKey,
}: {
  rows: ReadonlyMap<string, HomeRow>;
  /** Changes when the reader changes a filter; the feed follows at once. */
  filterKey: string;
}) {
  const { t } = useTranslation();
  const {
    agents,
    isInitialLoad,
    directoryHealth,
    accepted,
    needs,
    limit,
    showMore,
    pending,
    update,
  } = useHomeActivity();
  const activity = useNavigationActivity();
  const requestApply = useApplyReaderChanges(filterKey);
  const showHost = useHosts().length > 1;
  // Stable across updates, so a row that did not change skips its render (acceptance P5).
  const open = useStableEvent((agent: AggregatedAgent) => {
    if (rows.get(activityKey(agent))?.issue) activity.markSeen(agent);
    rememberChatReturn(HOME_PATH);
    navigateToAgent({
      serverId: agent.serverId,
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      pin: true,
    });
  });
  const sections = visibleActivityLayout(accepted, limit);
  const total = (list: ActivityLayoutSection[]) => list.reduce((n, s) => n + s.keys.length, 0);
  const hasMore = total(sections) < total(accepted);
  const live = useMemo(() => new Map(agents.map((agent) => [activityKey(agent), agent])), [agents]);
  const unseen = useMemo(
    () => agents.filter((agent) => rows.get(activityKey(agent))?.issue?.state === "unseen"),
    [agents, rows],
  );
  const markAll = useCallback(() => {
    activity.markAllSeen(unseen);
    requestApply();
  }, [activity, requestApply, unseen]);
  // The chips and section titles already say what this is, and loading is the skeleton. A Host
  // that drops is the connection notice's to say; the directory line is for a connected Host
  // whose list failed to load.
  const failed = directoryHealth.status === "unavailable" && directoryHealth.recovery === "retry";
  const offline = useHostsReachability() === "unreachable" && !accepted.length;
  const empty = !isInitialLoad && directoryHealth.hasAcceptedResult && !accepted.length;
  const hasActions = pending > 0 || unseen.length > 1;
  const hasHeader = failed || isInitialLoad || empty || hasActions || offline;
  return (
    <View style={styles.container} testID="home-activity">
      <HoldReadingPosition style={styles.headerSlot}>
        <View style={[styles.header, hasHeader && styles.headerFilled]}>
          {failed ? <DirectoryStatus health={directoryHealth} label="" inset={false} /> : null}
          {offline ? (
            <HostsUnreachableState testID="home-feed-offline" withDetails={false} />
          ) : null}
          {isInitialLoad && !offline ? <ActivityPlaceholder /> : null}
          {empty ? (
            <ListState
              kind="empty"
              title={t("navigation.lists.emptyFeed")}
              testID="home-feed-empty"
            />
          ) : null}
          {hasActions ? (
            <View style={styles.markAll}>
              {/* Held while the reader is on Home; applying is the reader's choice, not a banner. */}
              {pending > 0 ? (
                <Button size="xs" variant="ghost" onPress={update} testID="home-activity-apply">
                  {t("navigation.updates", { count: pending })}
                </Button>
              ) : null}
              {unseen.length > 1 ? (
                <Button size="xs" variant="ghost" onPress={markAll} testID="home-mark-all-seen">
                  {t("navigation.actions.markAllSeen")}
                </Button>
              ) : null}
            </View>
          ) : null}
        </View>
      </HoldReadingPosition>
      {sections.map((section) => (
        <FeedSection
          key={section.key}
          section={section}
          live={live}
          rows={rows}
          needs={needs}
          showHost={showHost}
          onPress={open}
          onAction={requestApply}
        />
      ))}
      {hasMore ? (
        <Button variant="ghost" onPress={showMore} testID="home-activity-show-more">
          {t("navigation.actions.showMore")}
        </Button>
      ) : null}
    </View>
  );
}

/**
 * Home holds its layout still while the reader is on it (the Show updates bar). A change the
 * reader makes — a filter, Mark as seen, Dismiss — is not a surprise, so it applies at once.
 */
function useApplyReaderChanges(filterKey: string) {
  const { pending, update } = useHomeActivity();
  const requested = useRef(false);
  const first = useRef(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    requested.current = true;
  }, [filterKey]);
  useEffect(() => {
    if (!requested.current || pending === 0) return;
    requested.current = false;
    // The provider publishes the new layout in its own effect, which runs after this child's.
    const timer = setTimeout(update, 0);
    return () => clearTimeout(timer);
  }, [filterKey, pending, tick, update]);
  return useCallback(() => {
    requested.current = true;
    setTick((value) => value + 1);
  }, []);
}

function FeedSection({
  section,
  live,
  rows,
  needs,
  showHost,
  onPress,
  onAction,
}: {
  section: ActivityLayoutSection;
  live: Map<string, AggregatedAgent>;
  rows: ReadonlyMap<string, HomeRow>;
  needs: number;
  showHost: boolean;
  onPress: (agent: AggregatedAgent) => void;
  onAction: () => void;
}) {
  const { t } = useTranslation();
  const setChip = useNavigationStore((state) => state.setHomeChip);
  const seenOpen = useNavigationStore((state) => state.seenIssuesOpen);
  const setSeenOpen = useNavigationStore((state) => state.setSeenIssuesOpen);
  const chip = SECTION_CHIPS[section.key];
  const openChip = useCallback(() => chip && setChip(chip), [chip, setChip]);
  const toggleSeen = useCallback(() => setSeenOpen(!seenOpen), [seenOpen, setSeenOpen]);
  const seen = section.key === "seen";
  const title = sectionTitle(section, t);
  return (
    <View
      style={section.key === "recent" ? null : styles.section}
      testID={`home-activity-section-${section.key}`}
    >
      {seen ? (
        <SeenIssuesToggle count={section.keys.length} open={seenOpen} onPress={toggleSeen} />
      ) : (
        <SectionTitle
          title={title}
          chip={chip}
          count={section.key === "needs" ? needs : undefined}
          onPress={openChip}
        />
      )}
      {seen && !seenOpen
        ? null
        : section.keys.map((key) => (
            <FeedRow
              key={key}
              identity={key}
              agent={live.get(key)}
              row={rows.get(key)}
              dimmed={seen}
              showHost={showHost}
              homeBucket={section.key}
              onPress={onPress}
              onAction={onAction}
            />
          ))}
    </View>
  );
}

/** Needs me and Running open their chip; dates and Recent are plain headings. */
function SectionTitle({
  title,
  chip,
  count,
  onPress,
}: {
  title: string;
  chip: HomeChip | undefined;
  count?: number;
  onPress: () => void;
}) {
  if (!chip) return <Text style={styles.subheading}>{title}</Text>;
  return <SectionLink title={title} count={count} accessibilityLabel={title} onPress={onPress} />;
}

function sectionTitle(section: ActivityLayoutSection, t: (key: string) => string): string {
  if (section.key === "needs") return t("navigation.chips.needs");
  if (section.key === "active") return t("navigation.chips.running");
  return section.title;
}

interface FeedRowProps {
  identity: string;
  agent: AggregatedAgent | undefined;
  row: HomeRow | undefined;
  dimmed: boolean;
  showHost: boolean;
  homeBucket: string;
  onPress: (agent: AggregatedAgent) => void;
  onAction: () => void;
}

const FeedRow = memo(function FeedRow({
  identity,
  agent,
  row,
  dimmed,
  showHost,
  homeBucket,
  onPress,
  onAction,
}: FeedRowProps) {
  const { t } = useTranslation();
  return (
    <RenderProfile id={`HomeRow:${identity}`}>
      <ActivityAnchor identity={identity}>
        {agent ? (
          <View style={[styles.row, dimmed && styles.dimmed]}>
            <View style={styles.rowMain}>
              <ActivityRow
                agent={agent}
                homeBucket={homeBucket}
                showHost={showHost}
                onPress={onPress}
              />
            </View>
            {row?.issue ? (
              <IssueActions agent={agent} issue={row.issue} onAction={onAction} />
            ) : null}
          </View>
        ) : (
          <Text style={styles.muted}>{t("navigation.lists.unavailable")}</Text>
        )}
      </ActivityAnchor>
    </RenderProfile>
  );
}, sameFeedRowProps);

/** Live agents and rows are rebuilt on every update; a row compares them by value. */
function sameFeedRowProps(previous: FeedRowProps, next: FeedRowProps): boolean {
  return (
    previous.identity === next.identity &&
    previous.dimmed === next.dimmed &&
    previous.showHost === next.showHost &&
    previous.homeBucket === next.homeBucket &&
    previous.onPress === next.onPress &&
    previous.onAction === next.onAction &&
    equal(previous.row, next.row) &&
    equal(previous.agent, next.agent)
  );
}

function SeenIssuesToggle({
  count,
  open,
  onPress,
}: {
  count: number;
  open: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const Chevron = open ? MutedChevronDown : MutedChevronRight;
  const state = useMemo(() => ({ expanded: open }), [open]);
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityState={state}
      onPress={onPress}
      style={styles.seenToggle}
      hitSlop={SEEN_TOGGLE_HIT_SLOP}
      testID="home-seen-issues"
    >
      <Chevron size={ICON_SIZE.sm} />
      <Text style={styles.seenLabel}>{t("navigation.issues.seenIssues", { count })}</Text>
    </PressHighlight>
  );
}

/** The toggle is a compact line; the press area reaches the touch target. */
const SEEN_TOGGLE_HIT_SLOP = {
  top: (MIN_TOUCH_TARGET_SIZE - CONTROL_HEIGHTS.compact) / 2,
  bottom: (MIN_TOUCH_TARGET_SIZE - CONTROL_HEIGHTS.compact) / 2,
};

const MutedChevronDown = withUnistyles(ChevronDown, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const MutedChevronRight = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const styles = StyleSheet.create((theme) => ({
  // The slot always gives back the container's gap; the gap a filled header needs sits inside it,
  // so the reading-position hold measures it too.
  headerSlot: { marginBottom: -theme.spacing[4] },
  header: { gap: theme.spacing[4] },
  headerFilled: { paddingBottom: theme.spacing[4] },
  container: {
    gap: theme.spacing[4],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  section: { gap: theme.spacing[1] },
  subheading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  markAll: { flexDirection: "row", justifyContent: "flex-end" },
  row: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  rowMain: { flex: 1, minWidth: 0 },
  dimmed: { opacity: theme.opacity[50] },
  seenToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: CONTROL_HEIGHTS.compact,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  seenLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
