// One subject's or one resource's grants: a header-row table on a wide screen,
// cards on a phone. Readable first: the thing and its Level are foreground,
// context is muted at base size; surfaces come from table-styles.
// docs/features/access/access-screen.md

import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import type { AccessAssignment } from "./access-catalog";
import type { GrantGrouping, GrantRow } from "./access-grant-rows";
import { tableStyles } from "./table-styles";
import { RowActionsMenu } from "./team/row-actions-menu";

/** Team, Member, or Guest: what the person or group a row names is. */
function subjectKindLabel(kind: GrantRow["subject"]["kind"], t: TFunction): string {
  if (kind === "team") return t("hub.access.kinds.team");
  return kind === "member" ? t("hub.access.kinds.member") : t("hub.access.kinds.guest");
}

export interface GrantActions {
  pending: boolean;
  edit(assignment: AccessAssignment): void;
  remove(assignmentId: string): Promise<void>;
  /** Opens the Team or Host a row comes through. */
  openVia?(viaKey: string): void;
  /** Grants a row's resource to the subject on screen directly, over what a Team gives. */
  grantDirect?(row: GrantRow): void;
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
    () => ({
      grantedBy: rows.some((row) => row.grantedBy !== null),
      // A Member's list says where each grant comes from: Direct or a Team.
      via: grouping === "subject" && rows.some((row) => row.via !== null),
      actions: withActions,
    }),
    [grouping, rows, withActions],
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
  via: boolean;
  actions: boolean;
}

function HeaderRow({ grouping, columns }: { grouping: GrantGrouping; columns: Columns }) {
  const { t } = useTranslation();
  return (
    <View style={[settingsStyles.row, styles.tableRow, tableStyles.header]}>
      <Text style={[tableStyles.headerCell, styles.thing]}>
        {grouping === "subject" ? t("hub.access.table.resource") : t("hub.access.table.who")}
      </Text>
      {columns.via ? (
        <Text style={[tableStyles.headerCell, styles.via]}>{t("hub.access.table.accessVia")}</Text>
      ) : null}
      <Text style={[tableStyles.headerCell, styles.level]}>{t("hub.access.table.level")}</Text>
      <Text style={[tableStyles.headerCell, styles.details]}>{t("hub.access.table.details")}</Text>
      {columns.grantedBy ? (
        <Text style={[tableStyles.headerCell, styles.grantedBy]}>
          {t("hub.access.table.grantedBy")}
        </Text>
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
  const { t } = useTranslation();
  const thing =
    grouping === "subject"
      ? { name: row.resource.name, context: row.resource.context }
      : { name: row.subject.name, context: subjectKindLabel(row.subject.kind, t) };
  const viaDetail =
    row.via === null || columns.via ? [] : [t("hub.access.table.via", { via: row.via })];
  const details = [...row.details, ...viaDetail];
  const trailing = actions === undefined ? null : <GrantRowActions row={row} actions={actions} />;
  const via = columns.via ? <ViaCell row={row} open={actions?.openVia} /> : null;
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
        {via === null ? null : <Labelled label={t("hub.access.table.accessVia")}>{via}</Labelled>}
        <Labelled label={t("hub.access.table.level")}>
          <Text style={styles.value}>{row.level}</Text>
        </Labelled>
        {details.length === 0 ? null : (
          <Labelled label={t("hub.access.table.details")}>
            <Text style={styles.muted}>{details.join(", ")}</Text>
          </Labelled>
        )}
        {row.grantedBy === null ? null : (
          <Labelled label={t("hub.access.table.grantedBy")}>
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
      {via === null ? null : <View style={styles.via}>{via}</View>}
      <Text style={[styles.value, styles.level]}>{row.level}</Text>
      <Text style={[styles.muted, styles.details]}>{details.join(", ") || "—"}</Text>
      {columns.grantedBy ? (
        <Text style={[styles.muted, styles.grantedBy]}>{row.grantedBy ?? "—"}</Text>
      ) : null}
      {trailing}
    </View>
  );
}

/** Direct, or the Team the grant comes from, which opens that Team when it can. */
function ViaCell({ row, open }: { row: GrantRow; open: ((viaKey: string) => void) | undefined }) {
  const { t } = useTranslation();
  const { viaKey } = row;
  const press = useCallback(() => {
    if (viaKey !== null) open?.(viaKey);
  }, [open, viaKey]);
  if (row.via === null) return <Text style={styles.value}>{t("hub.access.table.direct")}</Text>;
  if (open === undefined || viaKey === null) return <Text style={styles.value}>{row.via}</Text>;
  return (
    <View style={styles.viaLink}>
      <Button
        size="xs"
        variant="ghost"
        onPress={press}
        accessibilityLabel={t("hub.access.table.open", { via: row.via })}
      >
        {row.via}
      </Button>
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
 * Edit, and Remove behind the menu so it is never next to Edit. A row that comes through a
 * Team is the Team's grant: Edit on Team changes it for the whole Team, and the menu opens the
 * Team or grants the same resource to this person alone. A row above the viewer's level says so.
 */
function GrantRowActions({ row, actions }: { row: GrantRow; actions: GrantActions }) {
  const { t } = useTranslation();
  const { assignment } = row;
  const edit = useCallback(() => {
    if (assignment !== null) actions.edit(assignment);
  }, [actions, assignment]);
  const menu = useMemo(() => rowMenu(row, actions, t), [actions, row, t]);
  if (assignment === null) return <View style={styles.actions} />;
  if (row.locked) {
    return (
      <View style={styles.actions}>
        <Text style={styles.muted}>{t("hub.access.table.aboveYourLevel")}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.actions, styles.actionButtons]}>
      <Button size="xs" variant="ghost" disabled={actions.pending} onPress={edit}>
        {editLabel(row, t)}
      </Button>
      {menu.length === 0 ? null : (
        <RowActionsMenu
          label={t("hub.access.table.rowActions", {
            subject: row.subject.name,
            resource: row.resource.name,
          })}
          actions={menu}
          disabled={actions.pending}
        />
      )}
    </View>
  );
}

function rowMenu(row: GrantRow, actions: GrantActions, t: TFunction) {
  const { assignment, viaKey } = row;
  if (assignment === null) return [];
  if (row.via === null) {
    return [
      {
        label: t("hub.access.table.remove"),
        destructive: true,
        onSelect: () => void actions.remove(assignment.id),
      },
    ];
  }
  const { openVia, grantDirect } = actions;
  return [
    ...(openVia === undefined || viaKey === null
      ? []
      : [{ label: t("hub.access.table.open", { via: row.via }), onSelect: () => openVia(viaKey) }]),
    ...(grantDirect === undefined
      ? []
      : [{ label: t("hub.access.table.grantDirectly"), onSelect: () => grantDirect(row) }]),
  ];
}

/** Edit, or "Edit on Team" / "Edit on Host" for a row that comes through one. */
function editLabel(row: GrantRow, t: TFunction): string {
  if (row.via === null) return t("hub.access.table.edit");
  return row.viaKey?.startsWith("daemon:") === true
    ? t("hub.access.table.editOnHost")
    : t("hub.access.table.editOnTeam");
}

const styles = StyleSheet.create((theme) => ({
  tableRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[4] },
  thing: { flex: 3, minWidth: 0 },
  thingText: { flexShrink: 1, minWidth: 0, gap: theme.spacing[0.5] },
  level: { flex: 2, minWidth: 0 },
  details: { flex: 2, minWidth: 0 },
  grantedBy: { flex: 1.5, minWidth: 0 },
  actions: { width: 152, flexDirection: "row", justifyContent: "flex-end" },
  via: { flex: 1.5, minWidth: 0, alignItems: "flex-start" },
  viaLink: { marginLeft: -theme.spacing[2] },
  actionButtons: { alignItems: "center", gap: theme.spacing[1] },
  value: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  card: { gap: theme.spacing[2] },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] },
  labelled: { gap: theme.spacing[0.5] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
