import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CalendarClock, Ellipsis, FolderKanban, Home, MessageSquare } from "lucide-react-native";
import { ConnectionStatusDot } from "@/components/host-status-dot";
import { StatusBadge } from "@/components/ui/status-badge";
import { useNavigationActivity } from "./activity";
import { useHostsStatus } from "./hosts-status";
import { CHATS_PATH, HOME_PATH, MORE_PATH, SCHEDULES_PATH, WORK_PATH } from "./sections";
import { useNavigationStore } from "./store";

/** The phone tabs (brief C9): Home · Chats · Work · Lịch · More, in the registry's order. */
export const NAVIGATION_V2_TABS = [
  { path: HOME_PATH, name: "home", labelKey: "navigation.sections.home", Icon: Home },
  { path: CHATS_PATH, name: "chats", labelKey: "navigation.sections.chats", Icon: MessageSquare },
  { path: WORK_PATH, name: "work", labelKey: "navigation.sections.work", Icon: FolderKanban },
  {
    path: SCHEDULES_PATH,
    name: "schedules",
    labelKey: "navigation.sections.schedules",
    Icon: CalendarClock,
  },
  { path: MORE_PATH, name: "more", labelKey: "navigation.sections.more", Icon: Ellipsis },
];

export function rememberListSection(path: string) {
  if (path === CHATS_PATH) useNavigationStore.getState().setLastList("chats");
  if (path === WORK_PATH) useNavigationStore.getState().setLastList("work");
}

export function lastListTabPath(): string {
  return useNavigationStore.getState().lastList === "chats" ? CHATS_PATH : WORK_PATH;
}

/** Home carries the reader's unseen issues; More mirrors the Hosts status dot (brief 3.1a). */
export function NavigationTabBadge({ path }: { path: string }) {
  if (path === HOME_PATH) return <HomeBadge />;
  if (path === MORE_PATH) return <HostsDot />;
  return null;
}

function HomeBadge() {
  const { badge } = useNavigationActivity();
  if (!badge) return null;
  return (
    <View style={styles.badge} testID="home-tab-badge">
      <StatusBadge label={String(badge)} variant="warning" size="xs" />
    </View>
  );
}

function HostsDot() {
  const status = useHostsStatus();
  if (status === "online") return null;
  return (
    <View style={styles.dot} testID="more-tab-hosts-dot">
      <ConnectionStatusDot status={status} small />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: { position: "absolute", top: -theme.spacing[2], left: theme.spacing[3] },
  dot: { position: "absolute", top: -theme.spacing[0.5], right: -theme.spacing[1] },
}));
