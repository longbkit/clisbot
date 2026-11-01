import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { FilterChips, type FilterChip } from "@/components/ui/filter-chips";
import type { ScopeCounts } from "./ownership";
import { ScopeTabs } from "./scope-tabs";
import type { ScopedSection } from "./store";

export type SectionBackdrop = "surface0" | "surfaceSidebar";

/**
 * The surface a list section sits on: a phone tab is a page on white, as Home is (docs/design.md:
 * content sits on white); the desktop list is the sidebar column.
 */
export function useSectionBackdrop(): SectionBackdrop {
  return useIsCompactFormFactor() ? "surface0" : "surfaceSidebar";
}

/**
 * The block under every list section's header, in one order and on one inset: For me / Others /
 * All, the quick-filter chips, then the Display row. Home, Chats and Work all draw this block, so
 * the three lists line up when the reader switches between them.
 */
export function SectionControls<T extends string>({
  section,
  scopeCounts,
  chips,
  chip,
  onChip,
  backdrop,
  display,
  leading,
  children,
}: {
  section: ScopedSection;
  scopeCounts: ScopeCounts;
  chips: readonly FilterChip<T>[];
  chip: T;
  onChip(value: T): void;
  /** The surface the chip row's fade dissolves into. */
  backdrop: SectionBackdrop;
  /** The Display menu, alone on its row. */
  display?: ReactNode;
  /** A row above the scope tabs for a wider choice (Home's Host filter); it brings its inset. */
  leading?: ReactNode;
  /** Rows that belong to this section only (Work's grouping tabs); each brings its inset. */
  children?: ReactNode;
}) {
  return (
    <View style={[styles.controls, !leading && styles.pageTop]} testID={`${section}-controls`}>
      {leading}
      <ScopeTabs section={section} counts={scopeCounts} />
      <FilterChips
        chips={chips}
        value={chip}
        onChange={onChip}
        scroll
        backdrop={backdrop}
        contentStyle={styles.inset}
        testID={`${section}-chip`}
      />
      {display ? <View style={[styles.inset, styles.display]}>{display}</View> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: { gap: theme.spacing[2], paddingBottom: theme.spacing[2] },
  // The block sits right under the section header, so it brings its own gap; Home's leading
  // Host row brings its own.
  pageTop: { paddingTop: theme.spacing[2] },
  inset: { paddingHorizontal: theme.spacing[3] },
  display: { flexDirection: "row", alignItems: "center" },
}));
