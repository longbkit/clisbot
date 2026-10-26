import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FilterChips, type FilterChip } from "@/components/ui/filter-chips";
import type { ScopeCounts } from "./ownership";
import { ScopeTabs } from "./scope-tabs";
import type { ScopedSection } from "./store";

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
  children,
}: {
  section: ScopedSection;
  scopeCounts: ScopeCounts;
  chips: readonly FilterChip<T>[];
  chip: T;
  onChip(value: T): void;
  /** The surface the chip row's fade dissolves into. */
  backdrop: "surface0" | "surfaceSidebar";
  /** The Display menu, alone on its row. */
  display?: ReactNode;
  /** Rows that belong to this section only (Work's grouping tabs); each brings its inset. */
  children?: ReactNode;
}) {
  return (
    <View style={styles.controls} testID={`${section}-controls`}>
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
  inset: { paddingHorizontal: theme.spacing[3] },
  display: { flexDirection: "row", alignItems: "center" },
}));
