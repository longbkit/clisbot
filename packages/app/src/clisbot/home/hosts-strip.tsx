import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AlertTriangle, ChevronRight, Globe, Plus, Server } from "lucide-react-native";
import { HostGlyphMark } from "@/components/host-status-dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isToolbarLabelTriggerHighlighted,
  toolbarLabelTriggerStyle,
  toolbarLabelTriggerTextStyle,
  ToolbarLabelTriggerIcon,
} from "@/components/ui/toolbar-label-trigger";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppDiagnosticStore } from "@/diagnostics/store";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { openHostOverview } from "@/navigation/settings-navigation";
import { buildSettingsAddHostRoute } from "@/utils/host-routes";
import type { Theme } from "@/styles/theme";
import { hubSubtitle, type StripHost, type StripHub } from "./hosts-strip-model";
import { useHostsStrip, useOpenHub } from "./hosts-strip-data";
import { ConnectionIssuesSheet } from "./connection-issues-sheet";

/**
 * Hosts at a glance, as a status line rather than a card: this computer, the Hosts you use, one
 * entry per shared Hub, a way to connect more, and one line when something needs attention.
 */
export function HostsStrip() {
  const compact = useIsCompactFormFactor();
  const { entries, hubs, issues, summary } = useHostsStrip();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const openDetails = useCallback(() => setDetailsOpen(true), []);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  if (!summary.total && !hubs.length) return null;
  const list = (
    <>
      {entries.map((host) => (
        <HostEntry key={host.serverId} host={host} />
      ))}
      {hubs.map((hub) => (
        <HubEntry key={hub.origin} hub={hub} />
      ))}
    </>
  );
  return (
    <View style={styles.section} testID="home-hosts">
      <View style={styles.header}>
        <Text style={styles.label}>Hosts</Text>
        <Text style={styles.muted}>
          {summary.online} of {summary.total} online
        </Text>
        <View style={styles.grow} />
        <ConnectMenu />
      </View>
      {compact ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
        >
          {list}
        </ScrollView>
      ) : (
        <View style={[styles.list, styles.wrap]}>{list}</View>
      )}
      {issues.length ? (
        <Pressable
          onPress={openDetails}
          style={issueStyle}
          accessibilityRole="button"
          testID="home-connection-issues"
        >
          <WarningGlyph size={14} />
          <Text style={[styles.issueText, styles.grow]} numberOfLines={1}>
            {issues.length === 1
              ? "1 connection needs attention"
              : `${issues.length} connections need attention`}
          </Text>
          <Text style={styles.muted}>View details</Text>
          <MutedChevron size={14} />
        </Pressable>
      ) : null}
      <ConnectionIssuesSheet issues={issues} visible={detailsOpen} onClose={closeDetails} />
    </View>
  );
}

function HostEntry({ host }: { host: StripHost }) {
  const open = useCallback(() => openHostOverview(host.serverId), [host.serverId]);
  const online = host.status === "online";
  const snapshot = useProvidersSnapshot(host.serverId, { enabled: online });
  const ready =
    snapshot.entries?.filter((entry) => entry.enabled !== false && entry.status === "ready")
      .length ?? 0;
  let subtitle = "Offline";
  if (online) subtitle = `${ready} ${ready === 1 ? "agent" : "agents"} ready`;
  else if (host.status === "connecting" || host.status === "idle") subtitle = "Connecting…";
  else if (host.status === "error") subtitle = "Can't connect";
  return (
    <Pressable
      onPress={open}
      style={entryStyle}
      accessibilityRole="button"
      accessibilityLabel={`${host.label}, ${subtitle}`}
      testID={`home-host-${host.serverId}`}
    >
      <View style={styles.mark}>
        <HostGlyphMark local={host.local} status={host.status} size={16} />
      </View>
      <View style={styles.entryText}>
        <Text style={styles.entryName} numberOfLines={1}>
          {host.label}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

/** Where a Hub entry leads: its Hosts when signed in, sign-in when asked, its connection otherwise. */
const HUB_DESTINATION = {
  online: "hosts",
  setup: "account",
  signIn: "account",
  unreachable: "hubs",
  connecting: "hubs",
} as const;

function HubEntry({ hub }: { hub: StripHub }) {
  const openHub = useOpenHub();
  const open = useCallback(() => {
    void openHub(hub.origin, HUB_DESTINATION[hub.state]);
  }, [openHub, hub.origin, hub.state]);
  const subtitle = hubSubtitle(hub);
  const attention = hub.state !== "online" && hub.state !== "connecting";
  return (
    <Pressable
      onPress={open}
      style={entryStyle}
      accessibilityRole="button"
      accessibilityLabel={`${hub.name} Hub, ${subtitle}`}
      testID={`home-hub-${hub.origin}`}
    >
      <View style={styles.mark}>
        <MutedGlyph Icon={Globe} size={16} />
      </View>
      <View style={styles.entryText}>
        <Text style={styles.entryName} numberOfLines={1}>
          {hub.name}
        </Text>
        <Text style={attention ? styles.warning : styles.muted} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

/** Add a computer or a Hub, or troubleshoot one that will not connect. */
function ConnectMenu() {
  const router = useRouter();
  const connectComputer = useCallback(
    () => router.push(buildSettingsAddHostRoute(Date.now())),
    [router],
  );
  const addHub = useCallback(
    () =>
      router.push({
        pathname: "/settings/hub/[hubSection]",
        params: { hubSection: "hubs", hubIntent: "add" },
      }),
    [router],
  );
  const troubleshoot = useCallback(() => useAppDiagnosticStore.getState().open(), []);
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        style={toolbarLabelTriggerStyle}
        accessibilityRole="button"
        accessibilityLabel="Connect"
        testID="home-connect"
      >
        {(state) => (
          <>
            <ToolbarLabelTriggerIcon>{plusGlyph}</ToolbarLabelTriggerIcon>
            <Text style={toolbarLabelTriggerTextStyle(isToolbarLabelTriggerHighlighted(state))}>
              Connect
            </Text>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sheetTitle="Connect">
        <DropdownMenuItem
          onSelect={connectComputer}
          description="Pairing link, QR code, address or SSH"
        >
          Connect a computer
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={addHub} description="Your own Hub or your company's">
          Add a Hub
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={troubleshoot}>Troubleshoot a connection</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Glyph({ Icon, size, color }: { Icon: typeof Server; size: number; color?: string }) {
  return <Icon size={size} color={color} />;
}
const MutedGlyph = withUnistyles(Glyph, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const MutedChevron = withUnistyles(ChevronRight, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const WarningGlyph = withUnistyles(AlertTriangle, (theme: Theme) => ({
  color: theme.colors.statusWarning,
}));
const PlusGlyph = withUnistyles(Plus, (theme: Theme) => ({ color: theme.colors.foregroundMuted }));
const plusGlyph = <PlusGlyph size={14} />;

const entryStyle = ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
  styles.entry,
  hovered && styles.hovered,
  pressed && styles.pressed,
];
const issueStyle = ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
  styles.issue,
  hovered && styles.hovered,
  pressed && styles.pressed,
];

const styles = StyleSheet.create((t) => ({
  section: {
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[2],
    paddingBottom: t.spacing[4],
  },
  header: { flexDirection: "row", alignItems: "center", gap: t.spacing[2] },
  label: { color: t.colors.foreground, fontSize: t.fontSize.base, fontWeight: t.fontWeight.medium },
  muted: { color: t.colors.foregroundMuted, fontSize: t.fontSize.sm },
  warning: { color: t.colors.statusWarning, fontSize: t.fontSize.sm },
  grow: { flex: 1, minWidth: 0 },
  list: { flexDirection: "row", gap: t.spacing[1] },
  wrap: { flexWrap: "wrap", marginLeft: -t.spacing[2] },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing[2],
    paddingVertical: t.spacing[1.5],
    paddingHorizontal: t.spacing[2],
    borderRadius: t.borderRadius.lg,
    maxWidth: 200,
  },
  hovered: { backgroundColor: t.colors.surface1 },
  pressed: { backgroundColor: t.colors.surface2 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: t.borderRadius.full,
    backgroundColor: t.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
  },
  entryText: { minWidth: 0, flexShrink: 1 },
  entryName: { color: t.colors.foreground, fontSize: t.fontSize.base },
  issue: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing[2],
    paddingVertical: t.spacing[1.5],
    paddingHorizontal: t.spacing[2],
    marginHorizontal: -t.spacing[2],
    borderRadius: t.borderRadius.lg,
  },
  issueText: { color: t.colors.foreground, fontSize: t.fontSize.sm },
}));
