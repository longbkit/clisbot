import { memo, useCallback, useRef, type ReactNode } from "react";
import { ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { Brain } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useDisclosureHold } from "@/agent-stream/disclosure";
import { ExpandableBadge } from "@/components/message";
import { useIsCompactFormFactor } from "@/constants/layout";
import { buildToolCallPresentation } from "@/tool-calls/presentation";
import { resolveToolCallIcon } from "@/utils/tool-call-icon";
import { describeToolCall } from "../grouping";
import { OverviewToolCallGroupSheet } from "../overview/sheet";
import type { LatestCallToolCallGroup } from "./model";

/** Contiguous tools only: other content stays at its chronological position. */
export const LatestCallToolCallGroupView = memo(function LatestCallToolCallGroupView({
  group,
  cwd,
  expanded,
  isLastInSequence,
  onExpandedChange,
  children,
}: {
  group: LatestCallToolCallGroup;
  cwd?: string;
  expanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const hold = useDisclosureHold();
  const call = group.latestToolCall ? describeToolCall(group.latestToolCall) : null;
  const presentation = call
    ? buildToolCallPresentation({
        toolName: call.name,
        status: call.status,
        error: call.error,
        detail: call.detail,
        metadata: call.metadata,
        cwd,
        resolveIcon: resolveToolCallIcon,
      })
    : null;
  // Runs also fold reasoning; a run of reasoning alone reads as a thought, as in the overview.
  const count = presentation
    ? t("bots.chat.toolActivity.count", { count: group.toolCallCount })
    : t("toolCallGroup.thought");
  const label =
    group.failedCount > 0
      ? `${count}, ${t("bots.chat.toolActivity.failed", { count: group.failedCount })}`
      : count;
  const latest = presentation
    ? [presentation.displayName, presentation.summary].filter(Boolean).join(" ")
    : "";
  const toggle = useCallback(() => {
    const apply = () => onExpandedChange(group.run.id, !expanded);
    // Compact opens a sheet; nothing in the timeline moves.
    if (compact) apply();
    else hold(apply);
  }, [compact, expanded, group.run.id, hold, onExpandedChange]);
  const close = useCallback(
    () => onExpandedChange(group.run.id, false),
    [group.run.id, onExpandedChange],
  );
  const renderDetails = useLatestCallDetails(children);
  const badge = (
    <ExpandableBadge
      testID="tool-call-group"
      label={label}
      secondaryLabel={latest || undefined}
      icon={presentation?.icon ?? Brain}
      isLoading={group.isLoading}
      isError={group.failedCount > 0}
      isExpanded={expanded && !compact}
      isLastInSequence={isLastInSequence}
      onToggle={toggle}
      renderDetails={compact ? undefined : renderDetails}
      borderlessWhenExpanded
    />
  );
  if (!compact) return badge;
  return (
    <>
      {badge}
      <OverviewToolCallGroupSheet
        visible={expanded}
        summary={latest ? `${label}: ${latest}` : label}
        onClose={close}
      >
        {children}
      </OverviewToolCallGroupSheet>
    </>
  );
});

function useLatestCallDetails(children: ReactNode) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollToLatest = useCallback(() => scrollRef.current?.scrollToEnd({ animated: false }), []);
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
        {children}
      </ScrollView>
    ),
    [children, scrollToLatest],
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: { maxHeight: 400 },
  content: { paddingTop: theme.spacing[1], paddingHorizontal: 13 },
}));
