import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-api-context";
import { searchScopeT } from "@/i18n/search-scope";
import type { ScopeRowModel } from "./rows";
import { openInWork } from "./work-navigation";

const UNDO_TOAST_MS = 6000;

/** One Undo at a time: a newer Show in Work replaces the toast, and with it this. */
let pendingUndo: (() => void) | null = null;

function runPendingUndo(): void {
  const undo = pendingUndo;
  pendingUndo = null;
  undo?.();
}

function UndoToast({ label }: { label: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.text} numberOfLines={2}>
        {searchScopeT("workFilterChanged", { label })}
      </Text>
      <Button size="xs" variant="ghost" onPress={runPendingUndo} testID="search-scope-undo">
        {searchScopeT("undo")}
      </Button>
    </View>
  );
}

/**
 * R4: replace the view filter with exactly this scope, and offer Undo. Never additive by surprise;
 * the list's own filter row builds A + B.
 */
export function useShowInWork(isCompact: boolean): (model: ScopeRowModel) => void {
  const toast = useToast();
  return useCallback(
    (model) => {
      if (!model.workTarget) return;
      const restore = openInWork(model.workTarget, { isCompact });
      const label = model.chips.map((chip) => chip.label).join(" · ");
      const dismiss = toast.show(<UndoToast label={label} />, {
        durationMs: UNDO_TOAST_MS,
        testID: "search-scope-show-in-work-toast",
      });
      pendingUndo = () => {
        restore();
        dismiss();
      };
    },
    [isCompact, toast],
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  text: { flexShrink: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
}));
