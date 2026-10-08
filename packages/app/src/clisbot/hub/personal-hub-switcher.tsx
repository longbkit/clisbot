import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { SidebarTopRow } from "./sidebar-top-row";

const Chevron = withUnistyles(ChevronRight);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The sidebar's top row on a Personal Hub. A Personal Hub has no organization or account to
 * switch, so the row opens the Hub settings.
 */
export function PersonalHubSwitcher({
  isActive,
  onPress,
}: {
  isActive: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <SidebarTopRow
      label={t("hub.account.sidebar.personalHub")}
      isActive={isActive}
      onPress={onPress}
      accessibilityLabel={t("hub.account.sidebar.personalHubSettings")}
      testID="personal-hub-settings"
    >
      <Chevron size={16} uniProps={mutedColor} />
    </SidebarTopRow>
  );
}
