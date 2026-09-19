import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChevronRight } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import {
  automationScopeLabel,
  filterAutomations,
  type AutomationListFilter,
  type HubScopedAutomation,
} from "./automation-access";
import { FilterChips, type FilterChip } from "./filter-chips";

/**
 * The Automations directory: Mine / Shared with me / All (Organization Admins)
 * chips, and one row per Automation with its scope, state, and pause reason.
 */
export function AutomationList({
  automations,
  viewerUserId,
  canManage,
  open,
  review,
}: {
  automations: readonly HubScopedAutomation[];
  viewerUserId: string | null;
  canManage: boolean;
  open(automationId: string): void;
  /** Opens the Automation's configuration so an Admin can enable it again. */
  review(automationId: string): void;
}) {
  const [filter, setFilter] = useState<AutomationListFilter>(canManage ? "all" : "mine");
  const chips = useMemo<FilterChip<AutomationListFilter>[]>(
    () => [
      {
        value: "mine",
        label: "Mine",
        count: filterAutomations(automations, "mine", viewerUserId).length,
      },
      {
        value: "shared",
        label: "Shared with me",
        count: filterAutomations(automations, "shared", viewerUserId).length,
      },
      ...(canManage ? [{ value: "all" as const, label: "All", count: automations.length }] : []),
    ],
    [automations, canManage, viewerUserId],
  );
  const visible = filterAutomations(automations, filter, viewerUserId);
  return (
    <View style={styles.list}>
      <FilterChips<AutomationListFilter> chips={chips} value={filter} onChange={setFilter} />
      {visible.length === 0 ? (
        <Text style={settingsStyles.rowHint}>No Automations match this filter.</Text>
      ) : (
        visible.map((automation) => (
          <ScopedAutomationRow
            key={automation.id}
            automation={automation}
            open={open}
            review={review}
          />
        ))
      )}
    </View>
  );
}

function ScopedAutomationRow({
  automation,
  open,
  review,
}: {
  automation: HubScopedAutomation;
  open(automationId: string): void;
  review(automationId: string): void;
}) {
  const openAutomation = useCallback(() => open(automation.id), [automation.id, open]);
  const reviewAutomation = useCallback(() => review(automation.id), [automation.id, review]);
  const paused = typeof automation.pausedReason === "string";
  const state = automationStateLabel(automation);
  return (
    <View>
      <AutomationListRow
        name={automation.name}
        description={`${state} · ${automationScopeLabel(automation.scope)}`}
        open={openAutomation}
      />
      {paused ? (
        <View style={styles.pausedRow}>
          <Text style={settingsStyles.rowError}>{`Paused: ${automation.pausedReason}`}</Text>
          {automation.scope !== "run" ? (
            <Button size="sm" variant="outline" onPress={reviewAutomation}>
              Review and enable
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function automationStateLabel(automation: Pick<HubScopedAutomation, "enabled" | "pausedReason">) {
  if (typeof automation.pausedReason === "string") return "Paused";
  return automation.enabled ? "Active" : "Disabled";
}

export function AutomationListRow({
  name,
  description,
  open,
}: {
  name: string;
  description?: string;
  open(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const rowStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      settingsStyles.row,
      styles.listRow,
      (hovered || pressed) && styles.highlight,
    ],
    [hovered],
  );
  return (
    <View onPointerEnter={enter} onPointerLeave={leave}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}`}
        onPress={open}
        style={rowStyle}
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{name}</Text>
          {description ? <Text style={settingsStyles.rowHint}>{description}</Text> : null}
        </View>
        <ChevronRight style={styles.chevron} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { gap: theme.spacing[3] },
  listRow: { minHeight: theme.spacing[12], borderRadius: theme.borderRadius.lg },
  highlight: { backgroundColor: theme.colors.interactionHighlight },
  chevron: {
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    color: theme.colors.foregroundMuted,
  },
  pausedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
}));
