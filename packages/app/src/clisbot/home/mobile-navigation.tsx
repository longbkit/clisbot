import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { View, Text, Pressable, BackHandler } from "react-native";
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
const entries = [
  { path: "/open-project", name: "Home", Icon: Home },
  { path: "/chat", name: "Chat", Icon: MessageSquare },
  { path: "/sessions", name: "Inbox", Icon: Inbox },
  { path: "/schedules", name: "Automations", Icon: CalendarClock },
];
export function isHomeTabPath(path: string) {
  return entries.some((entry) => entry.path === path);
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
export function MobileHomeTabs() {
  const compact = useIsCompactFormFactor();
  const path = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const returnPath = useReturn((s) => s.path);
  const detail = isChatDetail(path);
  useEffect(() => {
    if (!HOME_V2_ENABLED || !compact || !detail) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (usePanelStore.getState().mobilePanel.target !== "agent") {
        usePanelStore.getState().showMobileAgent();
        return true;
      }
      router.navigate(returnPath as Href);
      return true;
    });
    return () => listener.remove();
  }, [compact, detail, returnPath, router]);
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
export function MobileChatBack() {
  const path = usePathname();
  const router = useRouter();
  const compact = useIsCompactFormFactor();
  const target = useReturn((s) => s.path);
  const back = useCallback(() => {
    usePanelStore.getState().showMobileAgent();
    router.navigate(target as Href);
  }, [router, target]);
  if (!HOME_V2_ENABLED || !compact || !isChatDetail(path)) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to conversations"
      testID="chat-back"
      onPress={back}
      style={styles.back}
    >
      <BackGlyph size={22} />
    </Pressable>
  );
}
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
  },
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
