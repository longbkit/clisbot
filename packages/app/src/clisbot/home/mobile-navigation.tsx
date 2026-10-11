import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { View, Text, Pressable, BackHandler, type PressableStateCallbackType } from "react-native";
import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, type Href } from "expo-router";
import { create } from "zustand";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, MessageSquare, Inbox, CalendarClock, ArrowLeft } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { HOME_V2_ENABLED } from "./feature";
import type { Theme } from "@/styles/theme";
import { StatusBadge } from "@/components/ui/status-badge";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { activityBucket } from "./activity";
const useReturn = create<{ path: string }>(() => ({ path: "/chat" }));
export function rememberChatReturn(path: string) {
  useReturn.setState({ path });
}
export const HOME_TAB_PATH = "/open-project";
const entries = [
  { path: HOME_TAB_PATH, name: "Home", Icon: Home },
  { path: "/chat", name: "Chat", Icon: MessageSquare },
  { path: "/sessions", name: "Inbox", Icon: Inbox },
  { path: "/schedules", name: "Automations", Icon: CalendarClock },
];
export function isHomeTabPath(path: string) {
  return entries.some((entry) => entry.path === path);
}
/** A Home V2 phone tab page: the tab bar is its navigation, so its header has no leading button. */
export function useIsMobileTabPage() {
  const compact = useIsCompactFormFactor();
  const path = usePathname();
  return HOME_V2_ENABLED && compact && isHomeTabPath(path);
}
function isChatDetail(path: string) {
  return path.startsWith("/h/") && (path.includes("/workspace/") || path.includes("/chat/"));
}
function Tab({
  entry,
  selected,
  count,
}: {
  entry: (typeof entries)[number];
  selected: boolean;
  count?: number;
}) {
  const router = useRouter();
  const state = useMemo(() => ({ selected }), [selected]);
  const open = useCallback(() => {
    if (entry.path === "/chat") {
      rememberChatReturn("/chat");
      usePanelStore.getState().showMobileAgentList();
    } else usePanelStore.getState().showMobileAgent();
    router.navigate(entry.path as Href);
  }, [entry.path, router]);
  return (
    <Pressable accessibilityRole="tab" accessibilityState={state} style={styles.tab} onPress={open}>
      <View>
        <TabGlyph Icon={entry.Icon} uniProps={selected ? selectedGlyph : mutedGlyph} />
        {count ? (
          <View style={styles.count}>
            <StatusBadge label={String(count)} variant="warning" size="xs" />
          </View>
        ) : null}
      </View>
      <Text style={[styles.text, selected && styles.selected]}>{entry.name}</Text>
    </Pressable>
  );
}
/**
 * Android Back. A conversation returns to its entry surface; a tab other than Home goes Home; Home
 * leaves the app. Switching tabs pushes routes, so the router's own Back would bounce between tabs.
 */
function useMobileHardwareBack(path: string, compact: boolean) {
  const router = useRouter();
  const returnPath = useReturn((s) => s.path);
  const detail = isChatDetail(path);
  const tab = isHomeTabPath(path);
  useEffect(() => {
    if (!HOME_V2_ENABLED || !compact || (!detail && !tab)) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      const panels = usePanelStore.getState();
      if (detail && panels.mobilePanel.target !== "agent") {
        panels.showMobileAgent();
        return true;
      }
      if (path === HOME_TAB_PATH) {
        BackHandler.exitApp();
        return true;
      }
      panels.showMobileAgent();
      router.navigate((detail ? returnPath : HOME_TAB_PATH) as Href);
      return true;
    });
    return () => listener.remove();
  }, [compact, detail, path, returnPath, router, tab]);
}
export function MobileHomeTabs() {
  const compact = useIsCompactFormFactor();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  useMobileHardwareBack(path, compact);
  const inset = useMemo(() => ({ paddingBottom: Math.max(insets.bottom, 6) }), [insets.bottom]);
  // Reads what Home and the sidebar already loaded; the tab bar never starts its own fetch.
  const { agents } = useAggregatedAgents({ demand: false });
  const needsCount = agents.filter((agent) => activityBucket(agent) === "needs").length;
  if (!HOME_V2_ENABLED || !compact || !isHomeTabPath(path)) return null;
  return (
    <View style={[styles.tabs, inset]} testID="home-mobile-tabs">
      {entries.map((entry) => (
        <Tab
          key={entry.path}
          entry={entry}
          selected={path === entry.path}
          count={entry.path === "/sessions" ? needsCount : undefined}
        />
      ))}
    </View>
  );
}
/**
 * Home V2 phones have no sidebar to open: a tab page has no leading button, and every other page
 * (conversation detail, or New workspace, Connectors and Bot settings opened from Chat) goes Back.
 */
export function MobileBack() {
  const path = usePathname();
  const router = useRouter();
  const compact = useIsCompactFormFactor();
  const target = useReturn((s) => s.path);
  const back = useCallback(() => {
    usePanelStore.getState().showMobileAgent();
    router.navigate(target as Href);
  }, [router, target]);
  if (!HOME_V2_ENABLED || !compact || isHomeTabPath(path)) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      testID="chat-back"
      onPress={back}
      style={backStyle}
    >
      <BackGlyph size={22} />
    </Pressable>
  );
}
// The same hover and press fill as the other header buttons.
const backStyle = ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
  styles.back,
  (hovered || pressed) && styles.backHighlighted,
];
const styles = StyleSheet.create((t) => ({
  tabs: {
    flexDirection: "row",
    borderTopWidth: t.borderWidth[1],
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.surface0,
    paddingTop: t.spacing[2],
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing[1],
    minHeight: MIN_TOUCH_TARGET_SIZE,
  },
  count: { position: "absolute", top: -t.spacing[2], left: t.spacing[3] },
  text: { color: t.colors.foregroundMuted, fontSize: t.fontSize.sm },
  selected: { color: t.colors.foreground, fontWeight: t.fontWeight.medium },
  back: {
    minWidth: MIN_TOUCH_TARGET_SIZE,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: t.borderRadius.md,
  },
  backHighlighted: { backgroundColor: t.colors.interactionHighlight },
}));

function Glyph({ Icon, color }: { Icon: typeof Home; color?: string }) {
  return <Icon size={20} color={color} />;
}
const TabGlyph = withUnistyles(Glyph);
const mutedGlyph = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const selectedGlyph = (theme: Theme) => ({ color: theme.colors.foreground });
const BackGlyph = withUnistyles(ArrowLeft, (theme) => ({
  color: theme.colors.foreground,
}));
