import { useMemo } from "react";
import { Bot } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { MenuItem } from "@/components/ui/menu";
import type { Theme } from "@/styles/theme";
import { useBotProjectsPreference } from "./preferences";

const ThemedBot = withUnistyles(Bot);
const mutedIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/** The Projects display menu owns visibility; Bot projects use the ordinary project rows. */
export function BotProjectsToggle() {
  const visible = useBotProjectsPreference((state) => state.showBotProjects);
  const toggle = useBotProjectsPreference((state) => state.toggleBotProjects);
  const leading = useMemo(() => <ThemedBot size={14} uniProps={mutedIconMapping} />, []);
  return (
    <MenuItem
      selected={visible}
      leading={leading}
      closeOnSelect={false}
      onSelect={toggle}
      testID="sidebar-show-bot-projects"
    >
      Bot projects
    </MenuItem>
  );
}
