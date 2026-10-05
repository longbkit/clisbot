import { useCallback, useState, type ComponentType } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight, Inbox, Server, Smartphone } from "lucide-react-native";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useImportSession } from "@/hooks/use-import-session";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { buildWelcomeRoute } from "@/utils/host-routes";
import type { Theme } from "@/styles/theme";
import { homeCopy } from "./copy";

const ImportIcon = withUnistyles(Inbox);
const HostIcon = withUnistyles(Server);
const PairIcon = withUnistyles(Smartphone);
const Chevron = withUnistyles(ChevronRight);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type ThemedIcon = ComponentType<{ size: number; uniProps: typeof muted }>;

/** The less common ways in, one card of rows under the two primary actions. */
export function MoreActions() {
  const { t } = useTranslation();
  const router = useRouter();
  const importSession = useImportSession();
  const localServerId = useLocalDaemonServerId();
  const [pairOpen, setPairOpen] = useState(false);
  const addHost = useCallback(() => router.push(buildWelcomeRoute({ stay: true })), [router]);
  const openPair = useCallback(() => setPairOpen(true), []);
  const closePair = useCallback(() => setPairOpen(false), []);
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{homeCopy.more.title}</Text>
      <View style={styles.card}>
        <ActionRow
          Icon={ImportIcon}
          title={t("openProject.tiles.importSession.title")}
          description={t("openProject.tiles.importSession.description")}
          onPress={importSession.open}
          testID="open-project-import-session"
        />
        <ActionRow
          Icon={HostIcon}
          title={t("openProject.tiles.addHost.title")}
          description={t("openProject.tiles.addHost.description")}
          onPress={addHost}
          testID="open-project-add-host"
          last={!localServerId}
        />
        {localServerId ? (
          <ActionRow
            Icon={PairIcon}
            title={t("openProject.tiles.pairDevice.title")}
            description={t("openProject.tiles.pairDevice.description")}
            onPress={openPair}
            testID="open-project-pair-device"
            last
          />
        ) : null}
      </View>
      <PairDeviceModal
        serverId={localServerId ?? ""}
        visible={pairOpen}
        onClose={closePair}
        testID="open-project-pair-device-modal"
      />
      {importSession.sheet}
    </View>
  );
}

function ActionRow({
  Icon,
  title,
  description,
  onPress,
  testID,
  last = false,
}: {
  Icon: ThemedIcon;
  title: string;
  description: string;
  onPress: () => void;
  testID: string;
  last?: boolean;
}) {
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      !last && styles.divider,
      (hovered || pressed) && styles.hovered,
    ],
    [last],
  );
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} style={style}>
      <Icon size={18} uniProps={muted} />
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Chevron size={16} uniProps={muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  group: { gap: theme.spacing[2] },
  heading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  card: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  hovered: { backgroundColor: theme.colors.surface2 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
