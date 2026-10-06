import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { EmptyRow } from "./access-settings-feedback";
import { type HubRevision } from "./channel-settings-types";

/**
 * Only the active revision earns permanent space: the older entries are a read-only
 * log, so they stay behind a disclosure instead of growing the page with every save.
 */
export function ChannelRevisionHistory({
  revisions,
  activeRevisionId,
  close,
}: {
  revisions: HubRevision[] | undefined;
  activeRevisionId: string | undefined;
  close(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const trailing = useMemo(
    () => (
      <Button size="xs" variant="ghost" onPress={close}>
        Hide
      </Button>
    ),
    [close],
  );
  if (revisions === undefined || revisions.length === 0)
    return (
      <SettingsSection title="Revision history" trailing={trailing}>
        <View style={settingsStyles.card}>
          <EmptyRow message="Nothing saved yet." />
        </View>
      </SettingsSection>
    );
  const active = revisions.find((revision) => revision.id === activeRevisionId) ?? revisions[0]!;
  const older = revisions.filter((revision) => revision.id !== active.id);
  return (
    <SettingsSection title="Revision history" trailing={trailing}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <ChannelRevisionLine revision={active} active={active.id === activeRevisionId} />
          </View>
          {older.length === 0 ? null : (
            <Button size="xs" variant="ghost" onPress={toggle}>
              {expanded ? "Hide earlier" : `${String(older.length)} earlier`}
            </Button>
          )}
        </View>
        {expanded
          ? older.map((revision) => (
              <View key={revision.id} style={[settingsStyles.row, settingsStyles.rowBorder]}>
                <View style={settingsStyles.rowContent}>
                  <ChannelRevisionLine revision={revision} active={false} />
                </View>
              </View>
            ))
          : null}
      </View>
    </SettingsSection>
  );
}

function ChannelRevisionLine({ revision, active }: { revision: HubRevision; active: boolean }) {
  return (
    <View style={styles.revisionLine}>
      <Text style={settingsStyles.rowTitle}>
        {`Revision ${String(revision.version)}${active ? " · Active" : ""}`}
      </Text>
      <Text style={styles.revisionTime}>{new Date(revision.createdAt).toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  revisionLine: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  revisionTime: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
