import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import { MenuItem } from "@/components/ui/menu";
import { useBotProjectsPreference } from "./preferences";

export function BotProjectsToggle({ menu = false }: { menu?: boolean }) {
  const enabled = useBotsFeatureHosts().length > 0;
  const show = useBotProjectsPreference((state) => state.showBotProjects);
  const toggle = useBotProjectsPreference((state) => state.toggleBotProjects);
  const compact = useIsCompactFormFactor();
  const switchStyle = useMemo(
    () => [styles.switch, (compact || isNative) && styles.touchSwitch],
    [compact],
  );
  if (!enabled) return null;
  if (!menu)
    return (
      <View style={styles.toggle}>
        <Text style={styles.text}>Bot projects</Text>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <View>
              <Switch
                value={show}
                onValueChange={toggle}
                accessibilityLabel="Show Bot projects"
                testID="sidebar-toggle-bot-projects"
                style={switchStyle}
              />
            </View>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            <Text>Show bot projects in Workspaces</Text>
          </TooltipContent>
        </Tooltip>
      </View>
    );
  return (
    <MenuItem
      onSelect={toggle}
      testID="sidebar-show-bot-projects"
      selected={show}
      closeOnSelect={false}
    >
      Bot projects
    </MenuItem>
  );
}
export function BotProjectsGroup({ children }: { children: ReactNode }) {
  const collapsed = useBotProjectsPreference((state) => state.botProjectsCollapsed);
  const toggle = useBotProjectsPreference((state) => state.toggleBotProjectsCollapsed);
  const compact = useIsCompactFormFactor();
  const headingStyle = useMemo(
    () => [styles.heading, (compact || isNative) && styles.touchHeading],
    [compact],
  );
  const state = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const Chevron = collapsed ? CollapsedChevron : ExpandedChevron;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Bot projects"
        accessibilityState={state}
        aria-expanded={!collapsed}
        onPress={toggle}
        style={headingStyle}
        testID="sidebar-bot-projects-group"
      >
        <Chevron size={14} uniProps={mutedColor} />
        <Text style={styles.text}>Bot projects</Text>
      </Pressable>
      {collapsed ? null : children}
    </>
  );
}
const ExpandedChevron = withUnistyles(ChevronDown);
const CollapsedChevron = withUnistyles(ChevronRight);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const styles = StyleSheet.create((theme) => ({
  toggle: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], flexShrink: 0 },
  switch: { minWidth: 32, minHeight: 32 },
  touchSwitch: { minWidth: 44, minHeight: 44 },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 36,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  touchHeading: { minHeight: 44 },
  text: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
}));
