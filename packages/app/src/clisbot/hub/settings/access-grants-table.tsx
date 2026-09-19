// One subject's or one resource's grants: a header-row table on a wide screen,
// cards on a phone. Readable first: the thing and its Level are foreground,
// context is muted at base size; surfaces come from table-styles.
// docs/features/access/access-screen.md

import { useCallback, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import type { AccessAssignment } from "./access-catalog";
import type { GrantGrouping, GrantRow } from "./access-grant-rows";
import { tableStyles } from "./table-styles";
import { RowActionsMenu } from "./team/row-actions-menu";

const SUBJECT_KIND_LABELS = { team: "Team", member: "Member", guest: "Guest" } as const;

export interface GrantActions {
  pending: boolean;
  edit(assignment: AccessAssignment): void;
  remove(assignmentId: string): Promise<void>;
}

export function AccessGrantsTable({
  rows,
  grouping,
  empty,
  actions,
}: {
  /** One subject's grants (grouping "subject") or one resource's ("resource"). */
  rows: readonly GrantRow[];
  grouping: GrantGrouping;
  empty: string;
  /** Absent: the list is read-only (a Member's own access). */
  actions?: GrantActions;
}) {
  const compact = useIsCompactFormFactor();
  const withActions = actions !== undefined;
  const columns = useMemo<Columns>(
    () => ({ grantedBy: rows.some((row) => row.grantedBy !== null), actions: withActions }),
    [rows, withActions],
  );
  if (rows.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <View style={[settingsStyles.row, tableStyles.body]}>
          <Text style={styles.muted}>{empty}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={settingsStyles.card}>
      {compact ? null : <HeaderRow grouping={grouping} columns={columns} />}
      {rows.map((row, index) => (
        <GrantRowView
          key={row.key}
          row={row}
          bordered={!compact || index > 0}
          grouping={grouping}
          compact={compact}
          columns={columns}
          actions={actions}
        />
      ))}
    </View>
  );
}

/** Columns every row shares: Granted by only when some row knows it. */
interface Columns {
  grantedBy: boolean;
  actions: boolean;
}

function HeaderRow({ grouping, columns }: { grouping: GrantGrouping; columns: Columns }) {
  return (
    <View style={[settingsStyles.row, styles.tableRow, tableStyles.header]}>
      <Text style={[tableStyles.headerCell, styles.thing]}>
        {grouping === "subject" ? "Resource" : "Who"}
      </Text>
      <Text style={[tableStyles.headerCell, styles.level]}>Level</Text>
      <Text style={[tableStyles.headerCell, styles.details]}>Details</Text>
      {columns.grantedBy ? (
        <Text style={[tableStyles.headerCell, styles.grantedBy]}>Granted by</Text>
      ) : null}
      {columns.actions ? <View style={styles.actions} /> : null}
    </View>
  );
}

function GrantRowView({
  row,
  bordered,
  grouping,
  compact,
  columns,
  actions,
}: {
  row: GrantRow;
  bordered: boolean;
  grouping: GrantGrouping;
  compact: boolean;
  columns: Columns;
  actions: GrantActions | undefined;
}) {
  const thing =
    grouping === "subject"
      ? { name: row.resource.name, context: row.resource.context }
      : { name: row.subject.name, context: SUBJECT_KIND_LABELS[row.subject.kind] };
  const details = [...row.details, ...(row.via === null ? [] : [`via ${row.via}`])];
  const trailing = actions === undefined ? null : <GrantRowActions row={row} actions={actions} />;
  if (compact) {
    return (
      <View
        style={[
          settingsStyles.row,
          bordered ? settingsStyles.rowBorder : null,
          tableStyles.body,
          styles.card,
        ]}
      >
        <View style={styles.cardTop}>
          <Thing name={thing.name} context={thing.context} />
          {trailing}
        </View>
        <Labelled label="Level">
          <Text style={styles.value}>{row.level}</Text>
        </Labelled>
        {details.length === 0 ? null : (
          <Labelled label="Details">
            <Text style={styles.muted}>{details.join(", ")}</Text>
          </Labelled>
        )}
        {row.grantedBy === null ? null : (
          <Labelled label="Granted by">
            <Text style={styles.muted}>{row.grantedBy}</Text>
          </Labelled>
        )}
      </View>
    );
  }
  return (
    <View
      style={[
        settingsStyles.row,
        bordered ? settingsStyles.rowBorder : null,
        tableStyles.body,
        styles.tableRow,
      ]}
    >
      <View style={styles.thing}>
        <Thing name={thing.name} context={thing.context} />
      </View>
      <Text style={[styles.value, styles.level]}>{row.level}</Text>
      <Text style={[styles.muted, styles.details]}>{details.join(", ") || "—"}</Text>
      {columns.grantedBy ? (
        <Text style={[styles.muted, styles.grantedBy]}>{row.grantedBy ?? "—"}</Text>
      ) : null}
      {trailing}
    </View>
  );
}

function Thing({ name, context }: { name: string; context: string }) {
  return (
    <View style={styles.thingText}>
      <Text style={styles.value}>{name}</Text>
      <Text style={styles.muted}>{context}</Text>
    </View>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.labelled}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

/**
 * Edit, and Remove behind the menu so it is never next to Edit. A row that
 * comes through a Team has none (it is edited on the Team); a row above the
 * viewer's level says so instead.
 */
function GrantRowActions({ row, actions }: { row: GrantRow; actions: GrantActions }) {
  const { assignment } = row;
  const edit = useCallback(() => {
    if (assignment !== null) actions.edit(assignment);
  }, [actions, assignment]);
  const menu = useMemo(
    () => [
      {
        label: "Remove",
        destructive: true,
        onSelect: () => {
          if (assignment !== null) void actions.remove(assignment.id);
        },
      },
    ],
    [actions, assignment],
  );
  if (assignment === null) return <View style={styles.actions} />;
  if (row.locked) {
    return (
      <View style={styles.actions}>
        <Text style={styles.muted}>Above your level</Text>
      </View>
    );
  }
  return (
    <View style={[styles.actions, styles.actionButtons]}>
      <Button size="xs" variant="ghost" disabled={actions.pending} onPress={edit}>
        Edit
      </Button>
      <RowActionsMenu
        label={`Actions for ${row.subject.name} on ${row.resource.name}`}
        actions={menu}
        disabled={actions.pending}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  tableRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[4] },
  thing: { flex: 3, minWidth: 0 },
  thingText: { flexShrink: 1, minWidth: 0, gap: theme.spacing[0.5] },
  level: { flex: 2, minWidth: 0 },
  details: { flex: 2, minWidth: 0 },
  grantedBy: { flex: 1.5, minWidth: 0 },
  actions: { width: 112, flexDirection: "row", justifyContent: "flex-end" },
  actionButtons: { alignItems: "center", gap: theme.spacing[1] },
  value: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  card: { gap: theme.spacing[2] },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] },
  labelled: { gap: theme.spacing[0.5] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
