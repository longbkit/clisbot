import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Pin } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { ICON_SIZE } from "@/styles/theme";

const ThemedPin = withUnistyles(Pin, (theme) => ({ color: theme.colors.foregroundMuted }));

/** The one "pinned" mark: list rows, floated pins and pin tags all draw this glyph. */
export function PinMark() {
  const { t } = useTranslation();
  return (
    <View accessible accessibilityLabel={t("bots.workspace.sidebar.pinned")}>
      <ThemedPin size={ICON_SIZE.xs} />
    </View>
  );
}
