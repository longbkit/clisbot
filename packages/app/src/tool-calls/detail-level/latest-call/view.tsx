import { memo, useCallback, useRef, type ReactNode } from "react";
import { ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
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
  const call = describeToolCall(group.run.latest);
  const presentation = buildToolCallPresentation({
    toolName: call.name,
    status: call.status,
    error: call.error,
    detail: call.detail,
    metadata: call.metadata,
    cwd,
    resolveIcon: resolveToolCallIcon,
  });
  const count = t("bots.chat.toolActivity.count", { count: group.run.calls.length });
  const label =
    group.failedCount > 0
      ? `${count}, ${t("bots.chat.toolActivity.failed", { count: group.failedCount })}`
      : count;
  const latest = [presentation.displayName, presentation.summary].filter(Boolean).join(" ");
  const toggle = useCallback(
    () => onExpandedChange(group.run.id, !expanded),
    [group.run.id, expanded, onExpandedChange],
  );
  const close = useCallback(
    () => onExpandedChange(group.run.id, false),
    [group.run.id, onExpandedChange],
  );
  const renderDetails = useLatestCallDetails(children);
  const badge = (
    <ExpandableBadge
      testID="tool-call-group"
      label={label}
      secondaryLabel={latest}
      icon={presentation.icon}
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
        summary={`${label}: ${latest}`}
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
