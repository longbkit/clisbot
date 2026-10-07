import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { QrCode, Link2, ClipboardPaste, Terminal } from "lucide-react-native";
import { isFdroidBuild } from "@/constants/build-profile";
import { isNative } from "@/constants/platform";
import { isElectronRuntime } from "@/desktop/host";
import { ExternalLink } from "@/components/ui/external-link";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

const ThemedQrCode = withUnistyles(QrCode);
const ThemedLink2 = withUnistyles(Link2);
const ThemedClipboardPaste = withUnistyles(ClipboardPaste);
const ThemedTerminal = withUnistyles(Terminal);
// Neutral, as on the open-project cards: these are choices, and accent is one CTA per surface.
const CONNECTIVITY_DOCS_URL = "https://clisbot.com/docs/connectivity";
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export type HostConnectionMethod = "scanQr" | "pasteLink" | "direct" | "remoteSsh";

export interface HostConnectionMethodsProps {
  onScanQr: () => void;
  onPasteLink: () => void;
  onDirectConnection: () => void;
  onRemoteSsh: () => void;
  testIDs: Record<HostConnectionMethod, string>;
}

/**
 * The ways to add your own computer, in one order everywhere (Welcome and Add connection):
 * pairing first, since the Host puts Tailscale in the link when it has it and relay otherwise
 * (docs/features/access/tailscale-connect.md), then the manual ways under "Other ways".
 * Platforms drop the rows they lack instead of reordering the rest.
 */
export function HostConnectionMethods(props: HostConnectionMethodsProps) {
  const { t } = useTranslation();
  const { testIDs } = props;
  const scanQr = isNative && !isFdroidBuild;
  return (
    <View style={styles.root}>
      <View style={styles.introBlock}>
        <Text style={styles.intro}>{t("pairing.connectionMethods.intro")}</Text>
        <ExternalLink href={CONNECTIVITY_DOCS_URL} label={t("pairing.connectionMethods.docs")} />
      </View>
      {scanQr ? (
        <MethodCard
          icon={ThemedQrCode}
          method="scanQr"
          onPress={props.onScanQr}
          testID={testIDs.scanQr}
        />
      ) : null}
      <MethodCard
        icon={ThemedClipboardPaste}
        method="pasteLink"
        // Without the QR row, "Same as the QR code" points at nothing: say what the link uses.
        describedAs={scanQr ? "pasteLink" : "scanQr"}
        onPress={props.onPasteLink}
        testID={testIDs.pasteLink}
      />
      <Text style={styles.groupLabel}>{t("pairing.connectionMethods.otherWays")}</Text>
      <MethodCard
        icon={ThemedLink2}
        method="direct"
        onPress={props.onDirectConnection}
        testID={testIDs.direct}
      />
      {isElectronRuntime() ? (
        <MethodCard
          icon={ThemedTerminal}
          method="remoteSsh"
          onPress={props.onRemoteSsh}
          testID={testIDs.remoteSsh}
        />
      ) : null}
    </View>
  );
}

/** One way to connect, as a lifted settings card (the open-project cards' shell). */
function MethodCard(props: {
  icon: typeof ThemedQrCode;
  method: HostConnectionMethod;
  /** The method whose description this card shows; its own by default. */
  describedAs?: HostConnectionMethod;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const Icon = props.icon;
  const title = t(`pairing.connectionMethods.${props.method}.title`);
  // Nothing inside the card is pressable and hover changes no geometry, so the Pressable's own
  // hover state is safe here (docs/hover.md).
  const style = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.card,
      styles.card,
      hovered && styles.hovered,
      pressed && styles.pressed,
    ],
    [],
  );
  return (
    <Pressable
      style={style}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={props.testID}
    >
      <Icon size={20} uniProps={iconColor} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>
          {t(`pairing.connectionMethods.${props.describedAs ?? props.method}.description`)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    width: "100%",
    gap: theme.spacing[3],
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  hovered: { backgroundColor: theme.colors.surface2 },
  pressed: { opacity: 0.85 },
  body: { flex: 1, gap: theme.spacing[1] },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  introBlock: {
    gap: theme.spacing[1],
    alignItems: "flex-start",
  },
  intro: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  groupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
  },
}));
