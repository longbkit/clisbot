import { nativePresentation } from "./chat-list-presentation";
import { useIsChatListDeparting } from "./use-chat-list-departure";
import { HeaderBackButton } from "@/components/headers/header-back-button";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import {
  View,
  Text,
  Pressable,
  BackHandler,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useNavigationContainerRef, usePathname, useRouter, type Href } from "expo-router";
import { create } from "zustand";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, MessageSquare, Inbox, CalendarClock } from "lucide-react-native";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import {
  NAVIGATION_V2_TABS,
  NavigationTabBadge,
  lastListTabPath,
  rememberListSection,
} from "@/clisbot/navigation/mobile-tabs";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb, isNative } from "@/constants/platform";
import { usePanelStore } from "@/stores/panel-store";
import { HOME_V2_ENABLED } from "./feature";
import type { Theme } from "@/styles/theme";
import { StatusBadge } from "@/components/ui/status-badge";
import { useInboxActivity, useInboxActivityLabel, InboxActivityIndicator } from "./inbox-activity";
import {
  startNativeInputTracing,
  traceInstant,
  traceBackNavigation,
} from "@/performance/native-trace";
import { navigateHomeTab, returnToPhoneTabs } from "./home-tab-navigation";
const useReturn = create<{ path: string }>(() => ({ path: "/chat" }));
export function rememberChatReturn(path: string) {
  useReturn.setState({ path });
}
export const HOME_TAB_PATH = "/open-project";
interface TabEntry {
  path: string;
  name: string;
  /** Navigation V2 tabs are translated (Lịch, Thêm); the Home V2 tabs keep their English names. */
  labelKey?: string;
  Icon: typeof Home;
}
const HOME_V2_TABS: readonly TabEntry[] = [
  { path: HOME_TAB_PATH, name: "Home", Icon: Home },
  { path: "/chat", name: "Chat", Icon: MessageSquare },
  { path: "/sessions", name: "Inbox", Icon: Inbox },
  { path: "/schedules", name: "Automations", Icon: CalendarClock },
];
const entries: readonly TabEntry[] = NAVIGATION_V2_ENABLED ? NAVIGATION_V2_TABS : HOME_V2_TABS;
export function isHomeTabPath(path: string) {
  return entries.some((entry) => entry.path === path);
}
/** Tabs whose page is the retained conversation list panel: Chat, or Navigation V2's Chats and Work. */
const LIST_TAB_PATHS: readonly string[] = NAVIGATION_V2_ENABLED ? ["/chat", "/work"] : ["/chat"];
export function isListTabPath(path: string) {
  return LIST_TAB_PATHS.includes(path);
}
/** The list tab a detail returns to, and the one the list panel shows. */
export function currentListTabPath(): string {
  return NAVIGATION_V2_ENABLED ? lastListTabPath() : "/chat";
}
/**
 * Navigation V2 phones keep their peer tabs in one retained tab navigator (`app/(tabs)`);
 * desktop, tablets and the Home V2 rollback keep the stack.
 */
export function usesPhoneTabs(compact: boolean): boolean {
  return NAVIGATION_V2_ENABLED && compact;
}
export function useUsesPhoneTabs(): boolean {
  return usesPhoneTabs(useIsCompactFormFactor());
}
/** All peer-tab entry points share one policy: phone tabs, native stack, or browser history. */
export function useNavigateHomeTab() {
  const router = useRouter();
  const root = useNavigationContainerRef();
  const compact = useIsCompactFormFactor();
  const nativeTab = HOME_V2_ENABLED && compact && !isWeb;
  const phoneTabs = usesPhoneTabs(compact) ? root : null;
  return useCallback(
    (href: Href) => navigateHomeTab({ router, href, nativeTab, phoneTabs }),
    [nativeTab, phoneTabs, router],
  );
}
/**
 * A detail's Back to the surface it opened from. Phone tabs pop back onto the retained tabs; the
 * stack keeps the host route underneath the entry page, which owns retained workspace/tab state.
 */
function useReturnFromDetail(target: string) {
  const router = useRouter();
  const root = useNavigationContainerRef();
  const phoneTabs = useUsesPhoneTabs();
  return useCallback(() => {
    if (phoneTabs) returnToPhoneTabs(root, router, target as Href);
    else router.navigate(target as Href);
  }, [phoneTabs, root, router, target]);
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
function tabStyle({ pressed }: PressableStateCallbackType) {
  return [styles.tab, pressed && styles.tabPressed];
}
interface TabProps {
  entry: TabEntry;
  selected: boolean;
  count?: number;
  /** Phone tabs: the tab navigator switches; no panel moves and no route is replaced. */
  onSelect?: (path: string) => void;
}
function Tab({ entry, selected, count, onSelect }: TabProps) {
  const navigate = useNavigateHomeTab();
  const router = useRouter();
  const inboxLabel = useInboxActivityLabel();
  const { t } = useTranslation();
  const name = entry.labelKey ? t(entry.labelKey) : entry.name;
  const open = useCallback(
    (event: GestureResponderEvent) => {
      traceInstant("clisbot.tab.press", {
        path: entry.path,
        eventMs: String(event.nativeEvent.timestamp),
      });
      if (onSelect) {
        if (selected) return;
        if (isListTabPath(entry.path)) {
          rememberChatReturn(entry.path);
          rememberListSection(entry.path);
        }
        onSelect(entry.path);
        return;
      }
      const panels = usePanelStore.getState();
      const pending = !isWeb && nativePresentation.isPending(panels.mobilePanel);
      if (selected && !isWeb) {
        if (isListTabPath(entry.path) && pending) {
          returnFromPendingChat(router, navigate);
        }
        return;
      }
      if (isListTabPath(entry.path)) {
        rememberChatReturn(entry.path);
        rememberListSection(entry.path);
        usePanelStore.getState().showMobileAgentList();
        // Web presents the panel a frame after the store changes; the route waits for it, so the
        // outgoing page stays under the panel instead of a blank frame between them.
        if (isWeb && NAVIGATION_V2_ENABLED && panels.mobilePanel.target !== "agent-list") {
          requestAnimationFrame(() => navigate(entry.path as Href));
          return;
        }
      } else if (!isWeb && panels.mobilePanel.target === "agent-list") {
        nativePresentation.begin(panels.mobilePanel, entry.path, panels.showMobileAgent);
      } else panels.showMobileAgent();
      navigate(entry.path as Href);
    },
    [entry.path, navigate, onSelect, router, selected],
  );
  return (
    <Pressable
      accessibilityRole="tab"
      aria-selected={selected}
      accessibilityLabel={entry.path === "/sessions" ? inboxLabel : name}
      testID={`home-tab-${entry.path.slice(1) || "home"}`}
      style={tabStyle}
      onPress={open}
    >
      <View>
        <TabGlyph Icon={entry.Icon} uniProps={selected ? selectedGlyph : mutedGlyph} />
        {count ? (
          <View style={styles.count}>
            <StatusBadge label={String(count)} variant="warning" size="xs" />
          </View>
        ) : null}
        {NAVIGATION_V2_ENABLED ? <NavigationTabBadge path={entry.path} /> : null}
      </View>
      <View style={styles.label}>
        <Text style={[styles.text, selected && styles.selected]} numberOfLines={1}>
          {name}
        </Text>
        {entry.path === "/sessions" ? <InboxActivityIndicator /> : null}
      </View>
    </Pressable>
  );
}
/** Shared by the pending header, selected Chat tab, and the sole hardware listener. */
export function returnFromPendingChat(
  router: Pick<ReturnType<typeof useRouter>, "navigate">,
  navigate: ReturnType<typeof useNavigateHomeTab>,
  expectedIntent?: number,
): boolean {
  if (!nativePresentation.isPending(usePanelStore.getState().mobilePanel)) return false;
  const destination = nativePresentation.getPendingDestination();
  if (!nativePresentation.returnToList(expectedIntent)) return false;
  const list = currentListTabPath();
  if (destination && isHomeTabPath(destination)) navigate(list as Href);
  else router.navigate(list as Href);
  return true;
}

/**
 * Android Back. A conversation returns to its entry surface; a tab other than Home goes Home; Home
 * leaves the app. Peer tabs replace their route; details keep the existing workspace return path.
 */
function useMobileHardwareBack(path: string, compact: boolean, departing: boolean) {
  const router = useRouter();
  const navigate = useNavigateHomeTab();
  const returnPath = useReturn((s) => s.path);
  const returnFromDetail = useReturnFromDetail(returnPath);
  const detail = isChatDetail(path);
  const tab = isHomeTabPath(path);
  useEffect(() => {
    if (!isNative || !HOME_V2_ENABLED || !compact || (!detail && !tab && !departing)) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      const panels = usePanelStore.getState();
      if (returnFromPendingChat(router, navigate)) return true;
      if (detail && panels.mobilePanel.target !== "agent") {
        panels.showMobileAgent();
        return true;
      }
      if (path === HOME_TAB_PATH) {
        BackHandler.exitApp();
        return true;
      }
      panels.showMobileAgent();
      if (detail) returnFromDetail();
      else navigate(HOME_TAB_PATH as Href);
      return true;
    });
    return () => listener.remove();
  }, [compact, departing, detail, navigate, path, returnFromDetail, router, tab]);
}
export function MobileHomeTabs() {
  const compact = useIsCompactFormFactor();
  const path = usePathname();
  const departing = useIsChatListDeparting();
  useEffect(startNativeInputTracing, []);
  useLayoutEffect(() => {
    traceInstant("clisbot.route.commit", { path });
  }, [path]);
  useMobileHardwareBack(path, compact, departing);
  // Phone tabs draw their own bar (`phone-tabs.tsx`); this owner keeps Back and tracing.
  if (usesPhoneTabs(compact)) return null;
  // Chat's bar belongs to the actual list panel. Keeping it outside that panel leaves a
  // footer on the destination between its UI-thread close and the settled JS notification.
  if (isListTabPath(path) || !isHomeTabPath(path)) return null;
  return <MobileTabBar path={path} />;
}

/** Visual-only: the retained sidebar must not install another Back/tracing owner. */
export function MobileChatPanelTabs() {
  const path = usePathname();
  const departing = useIsChatListDeparting();
  if (!isListTabPath(path) && !departing) return null;
  return <MobileTabBar path={isListTabPath(path) ? path : currentListTabPath()} />;
}

export function MobileTabBar({
  path,
  onSelect,
}: {
  path: string;
  onSelect?: (path: string) => void;
}) {
  const compact = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const inset = useMemo(() => ({ paddingBottom: Math.max(insets.bottom, 6) }), [insets.bottom]);
  // Reads what Home and the sidebar already loaded; the tab bar never starts its own fetch.
  const { needs: needsCount } = useInboxActivity();
  if (!HOME_V2_ENABLED || !compact) return null;
  return (
    <View style={[styles.tabs, inset]} testID="home-mobile-tabs">
      {entries.map((entry) => (
        <Tab
          key={entry.path}
          entry={entry}
          selected={path === entry.path}
          count={entry.path === "/sessions" && !NAVIGATION_V2_ENABLED ? needsCount : undefined}
          onSelect={onSelect}
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
  const compact = useIsCompactFormFactor();
  const target = useReturn((s) => s.path);
  const returnFromDetail = useReturnFromDetail(target);
  const committedPath = useRef(path);
  useLayoutEffect(() => {
    committedPath.current = path;
    traceBackNavigation("mobileCommit", path, target, usePanelStore.getState().mobilePanel);
  }, [path, target]);
  const back = useCallback(() => {
    traceBackNavigation(
      "mobileEnter",
      committedPath.current,
      target,
      usePanelStore.getState().mobilePanel,
    );
    usePanelStore.getState().showMobileAgent();
    traceBackNavigation(
      "panelChanged",
      committedPath.current,
      target,
      usePanelStore.getState().mobilePanel,
    );
    returnFromDetail();
    traceBackNavigation(
      "dispatchReturned",
      committedPath.current,
      target,
      usePanelStore.getState().mobilePanel,
    );
  }, [returnFromDetail, target]);
  if (!HOME_V2_ENABLED || !compact || isHomeTabPath(path)) return null;
  return <HeaderBackButton onBack={back} testID="chat-back" />;
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
  tabPressed: { backgroundColor: t.colors.interactionHighlight },
  count: { position: "absolute", top: -t.spacing[2], left: t.spacing[3] },
  text: { color: t.colors.foregroundMuted, fontSize: t.fontSize.sm },
  label: { flexDirection: "row", alignItems: "center", gap: t.spacing[1] },
  selected: { color: t.colors.foreground, fontWeight: t.fontWeight.medium },
}));

function Glyph({ Icon, color }: { Icon: typeof Home; color?: string }) {
  return <Icon size={20} color={color} />;
}
const TabGlyph = withUnistyles(Glyph);
const mutedGlyph = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const selectedGlyph = (theme: Theme) => ({ color: theme.colors.foreground });
