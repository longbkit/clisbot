import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { QrCode, Link2, ClipboardPaste, Terminal } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "./adaptive-modal-sheet";
import { isFdroidBuild } from "@/constants/build-profile";
import { isNative } from "@/constants/platform";
import { isElectronRuntime } from "@/desktop/host";
import type { Theme } from "@/styles/theme";

const ThemedQrCode = withUnistyles(QrCode);
const ThemedLink2 = withUnistyles(Link2);
const ThemedClipboardPaste = withUnistyles(ClipboardPaste);
const ThemedTerminal = withUnistyles(Terminal);
const foregroundIconMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const styles = StyleSheet.create((theme) => ({
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  optionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  optionSubtext: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    marginTop: theme.spacing[1],
  },
  optionBody: {
    flex: 1,
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

export interface AddHostMethodModalProps {
  visible: boolean;
  onClose: () => void;
  onDirectConnection: () => void;
  onRemoteSsh: () => void;
  onScanQr: () => void;
  onPasteLink: () => void;
}

export function AddHostMethodModal({
  visible,
  onClose,
  onDirectConnection,
  onRemoteSsh,
  onScanQr,
  onPasteLink,
}: AddHostMethodModalProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(() => ({ title: t("pairing.connectionMethods.title") }), [t]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      testID="add-host-method-modal"
    >
      <Text style={styles.intro}>{t("pairing.connectionMethods.intro")}</Text>
      {isNative && !isFdroidBuild ? (
        <MethodOption
          icon={ThemedQrCode}
          method="scanQr"
          onPress={onScanQr}
          testID="add-host-method-scan-qr"
        />
      ) : null}
      <MethodOption
        icon={ThemedClipboardPaste}
        method="pasteLink"
        onPress={onPasteLink}
        testID="add-host-method-pair-link"
      />
      <Text style={styles.groupLabel}>{t("pairing.connectionMethods.otherWays")}</Text>
      <MethodOption
        icon={ThemedLink2}
        method="direct"
        onPress={onDirectConnection}
        testID="add-host-method-direct"
      />
      {isElectronRuntime() ? (
        <MethodOption
          icon={ThemedTerminal}
          method="remoteSsh"
          onPress={onRemoteSsh}
          testID="add-host-method-remote-ssh"
        />
      ) : null}
    </AdaptiveModalSheet>
  );
}

function MethodOption(props: {
  icon: typeof ThemedQrCode;
  method: "scanQr" | "pasteLink" | "direct" | "remoteSsh";
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const Icon = props.icon;
  const title = t(`pairing.connectionMethods.${props.method}.title`);
  return (
    <Pressable
      style={styles.option}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={props.testID}
    >
      <Icon size={18} uniProps={foregroundIconMapping} />
      <View style={styles.optionBody}>
        <Text style={styles.optionText}>{title}</Text>
        <Text style={styles.optionSubtext}>
          {t(`pairing.connectionMethods.${props.method}.description`)}
        </Text>
      </View>
    </Pressable>
  );
}
