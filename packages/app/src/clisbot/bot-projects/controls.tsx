import { useMemo, type ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import { MenuItem } from "@/components/ui/menu";
import { useBotProjectsPreference } from "./preferences";

export function BotProjectsToggle({ menu = false }: { menu?: boolean }) {
  const enabled = useBotsFeatureHosts().length > 0;
  const show = useBotProjectsPreference((state) => state.showBotProjects);
  const toggle = useBotProjectsPreference((state) => state.toggleBotProjects);
  const accessibilityState = useMemo(() => ({ checked: show }), [show]);
  if (!enabled) return null;
  if (!menu)
    return (
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Show Bot projects"
        accessibilityState={accessibilityState}
        onPress={toggle}
        testID="sidebar-toggle-bot-projects"
        style={styles.toggle}
      >
        <Text style={styles.text}>{show ? "✓ Bot projects" : "Bot projects"}</Text>
      </Pressable>
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
  const state = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Bot projects"
        accessibilityState={state}
        onPress={toggle}
        style={styles.heading}
        testID="sidebar-bot-projects-group"
      >
        <Text style={styles.text}>{collapsed ? "▸" : "▾"} Bot projects</Text>
      </Pressable>
      {collapsed ? null : children}
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  toggle: { paddingHorizontal: 6, paddingVertical: 4 },
  heading: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6 },
  text: { fontSize: 12, fontWeight: "600", color: theme.colors.foregroundMuted },
}));
