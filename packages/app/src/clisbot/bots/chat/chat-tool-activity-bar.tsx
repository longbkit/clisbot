import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { TFunction } from "i18next";
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ExpandableBadge } from "@/components/message";
import { useIsCompactFormFactor } from "@/constants/layout";
import { OverviewToolCallGroupSheet } from "@/tool-calls/detail-level/overview/sheet";
import { describeToolCall } from "@/tool-calls/detail-level/grouping";
import { buildToolCallPresentation, type ToolCallPresentation } from "@/tool-calls/presentation";
import { resolveToolCallIcon } from "@/utils/tool-call-icon";
import { renderLiveItem } from "./chat-live-item";
import type { ChatBotIdentity } from "./chat-rows";
import type { ToolActivity, ToolActivityItem } from "./tool-activity";

const DETAILS_MAX_HEIGHT = 400;

/** How the agent stream would label this item: a tool's name and summary, or Thinking. */
export function toolActivityPresentation(
  item: ToolActivityItem,
  cwd: string | undefined,
): ToolCallPresentation {
  if (item.kind === "thought")
    return buildToolCallPresentation({
      toolName: "thinking",
      status: item.status === "ready" ? "completed" : "executing",
      error: null,
      cwd,
      resolveIcon: resolveToolCallIcon,
    });
  const call = describeToolCall(item);
  return buildToolCallPresentation({
    toolName: call.name,
    status: call.status,
    error: call.error ?? null,
    detail: call.detail,
    metadata: call.metadata,
    cwd,
    resolveIcon: resolveToolCallIcon,
  });
}

/** "14 tool calls", with the failures when there are any; thoughts alone have no count. */
export function toolActivityCountLabel(t: TFunction, activity: ToolActivity): string | null {
  if (activity.callCount === 0) return null;
  const count = t("bots.chat.toolActivity.count", { count: activity.callCount });
  if (activity.failedCount === 0) return count;
  return `${count}, ${t("bots.chat.toolActivity.failed", { count: activity.failedCount })}`;
}

/** The latest call's name and summary on one line, as its own row would read. */
export function toolActivityLatestLabel(presentation: ToolCallPresentation): string {
  return [presentation.displayName, presentation.summary].filter(Boolean).join(" ");
}

/**
 * The `collapsed` tool call display: one bar for a Bot turn. It names the latest call, counts the
 * turn's calls and failures, and shimmers while the latest call runs. Expanding shows the same
 * rows the `expanded` display shows; the parent keys it by turn, so a new turn starts closed.
 */
export const ChatToolActivityBar = memo(function ChatToolActivityBar({
  activity,
  bot,
  serverId,
  client,
}: {
  activity: ToolActivity;
  bot: ChatBotIdentity;
  serverId: string;
  client: DaemonClient | null;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const close = useCallback(() => setExpanded(false), []);
  const presentation = toolActivityPresentation(activity.latest, bot.cwd);
  const count = toolActivityCountLabel(t, activity);
  const latest = toolActivityLatestLabel(presentation);
  const rows = useMemo(
    () =>
      activity.items.map((item, index) =>
        renderLiveItem(item, serverId, index === activity.items.length - 1, bot, client),
      ),
    [activity.items, bot, client, serverId],
  );
  const renderDetails = useToolActivityDetails(rows);
  const badge = (
    <ExpandableBadge
      testID="chat-tool-activity-bar"
      label={count ?? latest}
      secondaryLabel={count ? latest : undefined}
      icon={presentation.icon}
      isLoading={activity.running}
      isError={activity.failedCount > 0}
      isExpanded={expanded && !compact}
      isLastInSequence
      onToggle={toggle}
      renderDetails={compact ? undefined : renderDetails}
      borderlessWhenExpanded
    />
  );
  if (!compact) return badge;
  return (
    <>
      {badge}
      <OverviewToolCallGroupSheet visible={expanded} summary={count ?? latest} onClose={close}>
        {rows}
      </OverviewToolCallGroupSheet>
    </>
  );
});

/** The expanded rows in a bounded scroll that follows the latest call. */
function useToolActivityDetails(rows: ReactNode) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);
  return useCallback(
    () => (
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        onContentSizeChange={scrollToLatest}
      >
        {rows}
      </ScrollView>
    ),
    [rows, scrollToLatest],
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: { maxHeight: DETAILS_MAX_HEIGHT },
  content: { paddingTop: theme.spacing[1], paddingHorizontal: 13 },
}));
