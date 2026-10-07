import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import { CornerLeftUp, Folder } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { pathBaseName } from "@/add-project-flow/options";
import { Button } from "@/components/ui/button";

const ThemedFolder = withUnistyles(Folder);
const ThemedCornerLeftUp = withUnistyles(CornerLeftUp);

/** `..` goes up one level; it is listed only when the Host lets this user browse the parent. */
export type BrowseRowItem = { kind: "parent" } | { kind: "folder"; path: string };

export interface BrowseListStatus {
  loading: boolean;
  error: string | null;
  /** True once the listing answers the current input; rows are hidden while it trails. */
  fresh: boolean;
  filter: string;
  retry(): void;
}

export function BrowseList({
  hostLabel,
  folderKey,
  rows,
  activeIndex,
  status,
  error,
  notice,
  disabled,
  onActivate,
}: {
  hostLabel: string;
  folderKey: string | undefined;
  rows: BrowseRowItem[];
  activeIndex: number;
  status: BrowseListStatus;
  error: string | null;
  notice: string | null;
  disabled: boolean;
  onActivate(row: BrowseRowItem): void;
}) {
  const scroll = useActiveRowVisible(activeIndex);
  const visibleRows = status.error ? [] : rows;
  return (
    <View style={styles.body}>
      {error ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>Folders</Text>
        <Text style={styles.sectionHost} numberOfLines={1}>
          {hostLabel}
        </Text>
      </View>
      <ScrollView
        key={folderKey}
        ref={scroll.ref}
        onLayout={scroll.onViewportLayout}
        onScroll={scroll.onScroll}
        scrollEventThrottle={32}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="always"
        testID="host-directory-browser-list"
      >
        {visibleRows.map((row, index) => (
          <BrowseRow
            key={row.kind === "parent" ? ".." : row.path}
            row={row}
            index={index}
            active={status.fresh && index === activeIndex}
            disabled={disabled}
            onActivate={onActivate}
            onRowLayout={scroll.onRowLayout}
          />
        ))}
        <BrowseStatus status={status} hasFolders={rows.some((row) => row.kind === "folder")} />
      </ScrollView>
      {notice ? <Text style={styles.hint}>{notice}</Text> : null}
    </View>
  );
}

function BrowseStatus({ status, hasFolders }: { status: BrowseListStatus; hasFolders: boolean }) {
  if (status.error) {
    return (
      <View style={styles.status}>
        <Text style={styles.errorText} accessibilityRole="alert">
          {status.error}
        </Text>
        <Button size="sm" variant="ghost" onPress={status.retry}>
          Retry
        </Button>
      </View>
    );
  }
  if (status.loading) return <Text style={styles.stateText}>Loading…</Text>;
  if (!status.fresh || hasFolders) return null;
  return (
    <Text style={styles.stateText} testID="host-directory-browser-empty">
      {status.filter ? `No folders matching “${status.filter}”` : "No subfolders"}
    </Text>
  );
}

function BrowseRow({
  row,
  index,
  active,
  disabled,
  onActivate,
  onRowLayout,
}: {
  row: BrowseRowItem;
  index: number;
  active: boolean;
  disabled: boolean;
  onActivate(row: BrowseRowItem): void;
  onRowLayout(index: number, event: LayoutChangeEvent): void;
}) {
  const name = row.kind === "parent" ? ".." : pathBaseName(row.path);
  const activate = useCallback(() => onActivate(row), [onActivate, row]);
  const layout = useCallback(
    (event: LayoutChangeEvent) => onRowLayout(index, event),
    [index, onRowLayout],
  );
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (active || hovered || pressed) && styles.rowActive,
    ],
    [active],
  );
  const Icon = row.kind === "parent" ? ThemedCornerLeftUp : ThemedFolder;
  return (
    <Pressable
      onPress={activate}
      onLayout={layout}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={row.kind === "parent" ? "Parent folder" : `Open folder ${name}`}
      style={rowStyle}
      testID={`host-directory-browser-row-${row.kind === "parent" ? "parent" : encodeURIComponent(name)}`}
    >
      <Icon size={16} uniProps={mutedIconColorMapping} />
      <Text numberOfLines={1} style={styles.rowTitle}>
        {name}
      </Text>
    </Pressable>
  );
}

/** Keeps the keyboard-highlighted row inside the scrolled list. */
function useActiveRowVisible(activeIndex: number) {
  const ref = useRef<ScrollView>(null);
  const rows = useRef(new Map<number, { y: number; height: number }>());
  const viewport = useRef({ offset: 0, height: 0 });
  useEffect(() => {
    const row = rows.current.get(activeIndex);
    const { offset, height } = viewport.current;
    if (!row || height === 0) return;
    if (row.y < offset) ref.current?.scrollTo({ y: row.y, animated: false });
    else if (row.y + row.height > offset + height) {
      ref.current?.scrollTo({ y: row.y + row.height - height, animated: false });
    }
  }, [activeIndex]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    viewport.current.offset = event.nativeEvent.contentOffset.y;
  }, []);
  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    viewport.current.height = event.nativeEvent.layout.height;
  }, []);
  const onRowLayout = useCallback((index: number, event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    rows.current.set(index, { y, height });
  }, []);
  return { ref, onScroll, onViewportLayout, onRowLayout };
}

const styles = StyleSheet.create((theme) => ({
  body: { flexShrink: 1, minHeight: 0, paddingTop: theme.spacing[2] },
  sectionRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1.5],
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  sectionHost: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  list: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  listContent: { paddingHorizontal: theme.spacing[2], paddingBottom: theme.spacing[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowActive: { backgroundColor: theme.colors.interactionHighlight },
  rowTitle: { flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[2],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[3],
  },
  errorText: {
    flexShrink: 1,
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
}));
