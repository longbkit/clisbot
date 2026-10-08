import * as Clipboard from "expo-clipboard";
import { useCallback, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react-native";
import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { useToast } from "@/contexts/toast-context";
import { wrappablePath } from "@/utils/shorten-path";

const ThemedCopy = withUnistyles(Copy);
const COPY_ICON = (
  <ThemedCopy size={iconButtonChromeGlyphSize("small")} uniProps={mutedIconColorMapping} />
);

function copyButtonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return iconButtonChromeStyle({ size: "small", state: { hovered, pressed } });
}

/**
 * The Project's root folder under its name in Project settings, readable at a glance and
 * copyable: which folder a Project is should never take a menu (docs/design.md, screen titles).
 */
export function ProjectPathLine({ path }: { path: string }): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const copy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(path);
      toast.copied(t("workspace.header.toasts.projectPathCopiedLabel"));
    } catch {
      toast.error(t("workspace.tabs.toasts.copyFailed"));
    }
  }, [path, toast, t]);
  if (!path) return null;
  return (
    <View style={styles.row} testID="project-settings-path">
      <Text style={styles.path}>{wrappablePath(path)}</Text>
      <Pressable
        testID="project-settings-copy-path"
        accessibilityRole="button"
        accessibilityLabel={t("workspace.header.actions.copyProjectPath")}
        onPress={copy}
        hitSlop={6}
        style={copyButtonStyle}
      >
        {COPY_ICON}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  path: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
