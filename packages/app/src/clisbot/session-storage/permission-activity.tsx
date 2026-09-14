import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentPermissionResponseRecord } from "@getpaseo/protocol/session-authorship";
import { Button } from "@/components/ui/button";
import { SessionActorLabel, actorLabel } from "./actor";
import type { TimelinePosition } from "@/types/stream";
import { permissionBelongsToTool, permissionActivityLabel } from "./permission-history";
import { PermissionSnapshotInspector } from "./permission-snapshot-inspector";

interface ActivityProps {
  records: readonly AgentPermissionResponseRecord[];
  serverId: string;
  workspaceId?: string;
}

/** Only a workspace-scoped responder can open a profile; otherwise the name is plain text. */
function PermissionResponder({
  responder,
  serverId,
  workspaceId,
}: {
  responder: AgentPermissionResponseRecord["respondedBy"];
  serverId: string;
  workspaceId: string | undefined;
}) {
  if (!responder) return null;
  if (!workspaceId) return <Text style={styles.text}>{actorLabel(responder)}</Text>;
  return <SessionActorLabel actor={responder} serverId={serverId} workspaceId={workspaceId} />;
}

function PermissionActivityRow({
  record,
  serverId,
  workspaceId,
}: Omit<ActivityProps, "records"> & { record: AgentPermissionResponseRecord }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const snapshot = useMemo(
    () => ({ request: record.request, response: record.response }),
    [record.request, record.response],
  );
  return (
    <View testID={`permission-response-${record.id}`}>
      <View style={styles.row}>
        <Text style={styles.text}>{permissionActivityLabel(record)}</Text>
        <Text style={styles.text} numberOfLines={2}>
          {record.request.title ?? record.request.name}
        </Text>
        <PermissionResponder
          responder={record.respondedBy}
          serverId={serverId}
          workspaceId={workspaceId}
        />
        <Text style={styles.text}>{new Date(record.timestamp).toLocaleString()}</Text>
        <Button variant="ghost" size="sm" onPress={toggle} accessibilityState={accessibilityState}>
          Request and response
        </Button>
      </View>
      {record.error ? <Text style={styles.text}>{record.error}</Text> : null}
      {expanded ? <PermissionSnapshotInspector value={snapshot} /> : null}
    </View>
  );
}

export function PermissionResponseActivity({ records, serverId, workspaceId }: ActivityProps) {
  if (!records.length) return null;
  return (
    <View style={styles.rows}>
      {records.map((record) => (
        <PermissionActivityRow
          key={record.id}
          record={record}
          serverId={serverId}
          workspaceId={workspaceId}
        />
      ))}
    </View>
  );
}

const PermissionActivityContext = createContext<ActivityProps | null>(null);
export function PermissionActivityProvider({
  records,
  serverId,
  workspaceId,
  children,
}: ActivityProps & { children: ReactNode }) {
  const value = useMemo(
    () => ({ records, serverId, workspaceId }),
    [records, serverId, workspaceId],
  );
  return <PermissionActivityContext value={value}>{children}</PermissionActivityContext>;
}
export function ToolPermissionActivity({
  toolCallId,
  position,
}: {
  toolCallId: string;
  position?: TimelinePosition;
}) {
  const activity = useContext(PermissionActivityContext);
  const records = useMemo(
    () =>
      activity?.records.filter((record) => permissionBelongsToTool(record, toolCallId, position)) ??
      [],
    [activity, toolCallId, position],
  );
  if (!activity) return null;
  return (
    <PermissionResponseActivity
      records={records}
      serverId={activity.serverId}
      workspaceId={activity.workspaceId}
    />
  );
}

export function PermissionHistoryPanel({
  records,
  serverId,
  workspaceId,
  loading,
  error,
  hasOlder,
  viewingOlder,
  hasNewActivity,
  windowKey,
  loadOlder,
  loadRecent,
}: ActivityProps & {
  loading: boolean;
  error: string | null;
  hasOlder: boolean;
  viewingOlder: boolean;
  hasNewActivity: boolean;
  windowKey: number;
  loadRecent: () => void;
  loadOlder: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  if (!records.length && !loading && !error && !hasNewActivity) return null;
  return (
    <View style={styles.panel}>
      <Button variant="ghost" size="sm" onPress={toggle} accessibilityState={accessibilityState}>
        Permission activity
      </Button>
      {hasNewActivity ? (
        <Text style={styles.text}>New permission activity is available.</Text>
      ) : null}
      {expanded ? (
        <ScrollView key={windowKey} style={styles.history}>
          <PermissionResponseActivity
            records={records}
            serverId={serverId}
            workspaceId={workspaceId}
          />
          {error ? (
            <Text style={styles.text} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {loading ? (
            <Text style={styles.text} accessibilityLiveRegion="polite">
              Loading permission activity…
            </Text>
          ) : null}
          {hasOlder ? (
            <Button variant="ghost" size="sm" onPress={loadOlder} disabled={loading}>
              Earlier activity
            </Button>
          ) : null}
          {viewingOlder || hasNewActivity || error ? (
            <Button variant="ghost" size="sm" onPress={loadRecent} disabled={loading}>
              Recent activity
            </Button>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  history: { maxHeight: 240 },
  rows: { gap: theme.spacing[1] },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[1] },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
