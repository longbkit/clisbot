import { useMemo, type ComponentType } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowUpRight, Building2, FolderGit2, Globe, Laptop, Server, X } from "lucide-react-native";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { findHighlightRanges } from "@/components/ui/highlighted-text-segments";
import { smallIconButtonChromeFrameSize } from "@/components/ui/icon-button-chrome";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { isNative } from "@/constants/platform";
import { COMMAND_CENTER_LINE_HEIGHT } from "@/command-center/list-metrics";
import { foldSearchText } from "./model";
import type { ScopeRowModel } from "./rows";

const muted = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const ICONS: Record<ScopeRowModel["icon"], ComponentType<{ size: number; strokeWidth: number }>> = {
  host: withUnistyles(Server, muted),
  local: withUnistyles(Laptop, muted),
  hub: withUnistyles(Building2, muted),
  project: withUnistyles(FolderGit2, muted),
  remove: withUnistyles(X, muted),
  everywhere: withUnistyles(Globe, muted),
};
const ThemedArrowUpRight = withUnistyles(ArrowUpRight, muted);
const SHOW_IN_WORK_SHORTCUT = [["mod", "Enter"]];

/** Marks on folded text: NFC folding keeps offsets, so `may` marks the "Máy" the user sees. */
function FoldedHighlight({ query, text, style }: { query: string; text: string; style: object }) {
  const ranges = useMemo(
    () => findHighlightRanges(foldSearchText(query), foldSearchText(text)),
    [query, text],
  );
  return <HighlightedText text={text} ranges={ranges} style={style} numberOfLines={1} />;
}

function StatusDot({ status }: { status: ScopeRowModel["status"] }) {
  if (!status) return null;
  return (
    <View
      style={[
        styles.dot,
        status === "online" && styles.dotOnline,
        status === "connecting" && styles.dotConnecting,
      ]}
    />
  );
}

export interface ScopeRowContentProps {
  model: ScopeRowModel;
  query: string;
}

/** A Host, Hub, Project or empty-state row in global search. Heights come from list-metrics. */
export function ScopeRowContent({ model, query }: ScopeRowContentProps) {
  const Icon = ICONS[model.icon];
  return (
    <View style={styles.rowContent} testID={model.testID}>
      <View style={styles.rowMain}>
        <View style={styles.iconSlot}>
          <Icon size={16} strokeWidth={2} />
        </View>
        <View style={styles.textContent}>
          <FoldedHighlight query={query} text={model.title} style={styles.title} />
          {model.subtitle || model.note ? (
            <View style={styles.subtitleLine}>
              <StatusDot status={model.status} />
              <FoldedHighlight query={query} text={model.subtitle} style={styles.subtitleText} />
              {model.note ? (
                <Text style={styles.note} numberOfLines={1}>
                  {model.subtitle ? `\u00a0· ${model.note}` : model.note}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
      {/* Reserves the trailing slot the "Show in Work" button sits over, so text never runs under it. */}
      {model.workTarget ? <View style={styles.actionSlot} /> : null}
    </View>
  );
}

export interface ScopeRowActionProps {
  model: ScopeRowModel;
  revealed: boolean;
  /** Touch layouts always show the action; pointer layouts reveal it on hover or keyboard. */
  touch: boolean;
  label: string;
  runSecondary(): void;
}

/** "Show in Work": laid out always, only revealed, so hovering never reflows the row. */
export function ScopeRowAction(props: ScopeRowActionProps) {
  const shown = props.revealed || props.touch || isNative;
  return (
    <View style={shown ? null : styles.hiddenAction} pointerEvents={shown ? "auto" : "none"}>
      <ToolbarButton
        label={props.label}
        shortcut={props.touch ? null : SHOW_IN_WORK_SHORTCUT}
        onPress={props.runSecondary}
        testID={`${props.model.testID}-show-in-work`}
      >
        <ThemedArrowUpRight size={16} strokeWidth={2} />
      </ToolbarButton>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  iconSlot: {
    width: 16,
    height: COMMAND_CENTER_LINE_HEIGHT.singleLine,
    alignItems: "center",
    justifyContent: "center",
  },
  textContent: { flex: 1, minWidth: 0, justifyContent: "center" },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: COMMAND_CENTER_LINE_HEIGHT.title,
    flexShrink: 1,
  },
  subtitleLine: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  subtitleText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: COMMAND_CENTER_LINE_HEIGHT.subtitle,
    // The subtitle gives way before the status note does.
    flexShrink: 3,
    minWidth: 0,
  },
  note: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: COMMAND_CENTER_LINE_HEIGHT.subtitle,
    flexShrink: 1,
    minWidth: 0,
  },
  dot: {
    width: 6,
    height: 6,
    marginRight: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.border,
  },
  dotOnline: { backgroundColor: theme.colors.statusDotSuccess },
  dotConnecting: { backgroundColor: theme.colors.statusDotWarning },
  hiddenAction: { opacity: 0 },
  actionSlot: {
    width: smallIconButtonChromeFrameSize(),
    height: smallIconButtonChromeFrameSize(),
  },
}));
