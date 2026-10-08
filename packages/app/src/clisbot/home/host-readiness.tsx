import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { AGENT_PROVIDER_DEFINITIONS } from "@clisbot/protocol/provider-manifest";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { Button } from "@/components/ui/button";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useConfirmRemoveHost } from "@/hosts/use-confirm-remove-host";
import {
  useHostRuntimeConnectionStatus,
  useHostRuntimeLastError,
  type HostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useProviderIcon } from "@/components/provider-icons";
import { useSessionStore } from "@/stores/session-store";
import { buildSettingsHostRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { settingsStyles } from "@/styles/settings";
import { homeCopy } from "./copy";

type Tone = "success" | "warning" | "danger" | "muted";

const CONNECTION: Record<HostRuntimeConnectionStatus, { label: string; tone: Tone }> = {
  online: { label: homeCopy.host.online, tone: "success" },
  connecting: { label: homeCopy.host.connecting, tone: "warning" },
  idle: { label: homeCopy.host.connecting, tone: "warning" },
  offline: { label: homeCopy.host.offline, tone: "danger" },
  error: { label: homeCopy.host.error, tone: "danger" },
};

/** Providers a Host can add: the built-ins (less the test mocks) and the ACP catalog. */
const ADDABLE_PROVIDER_COUNT = new Set([
  ...AGENT_PROVIDER_DEFINITIONS.map((definition) => definition.id).filter(
    (id) => !id.startsWith("mock"),
  ),
  ...ACP_PROVIDER_CATALOG.map((entry) => entry.id),
]).size;

/**
 * One Host: whether it is reachable, and which providers can start an agent on it. Two sections
 * of one settings card, split by a divider that runs edge to edge like a settings row border.
 */
export function HostReadinessCard({ serverId, label }: { serverId: string; label: string }) {
  const status = useHostRuntimeConnectionStatus(serverId);
  const lastError = useHostRuntimeLastError(serverId);
  const version = useSessionStore((state) => state.sessions[serverId]?.serverInfo?.version);
  const connection = CONNECTION[status];
  return (
    <View style={settingsStyles.card} testID={`home-host-${serverId}`}>
      <View style={styles.section}>
        <View style={styles.row}>
          <Dot tone={connection.tone} />
          <Text style={styles.hostName} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.muted}>{connection.label}</Text>
        </View>
        {version ? <Text style={styles.detail}>{homeCopy.host.version(version)}</Text> : null}
        {lastError && status !== "online" ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {lastError}
          </Text>
        ) : null}
        {status === "offline" || status === "error" ? (
          <HostRecovery serverId={serverId} label={label} />
        ) : null}
      </View>
      {status === "online" ? <ProviderReadiness serverId={serverId} /> : null}
    </View>
  );
}

/**
 * A Host that cannot connect: its ID tells two same-named Hosts apart, Details opens its
 * settings, and Remove forgets it here. The desktop's own daemon is removed from its page,
 * which also stops the daemon.
 */
function HostRecovery({ serverId, label }: { serverId: string; label: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const { remove, removing } = useConfirmRemoveHost(serverId, label);
  const openDetails = useCallback(
    () => router.push(buildSettingsHostRoute(serverId)),
    [router, serverId],
  );
  return (
    <View style={styles.recovery}>
      <Text style={styles.detail} selectable>
        {homeCopy.host.id(serverId)}
      </Text>
      <View style={styles.recoveryActions}>
        <Button
          variant="outline"
          size="sm"
          onPress={openDetails}
          testID={`home-host-details-${serverId}`}
        >
          {homeCopy.host.details}
        </Button>
        {isLocalDaemon ? null : (
          <Button
            variant="outline"
            size="sm"
            onPress={remove}
            disabled={removing}
            testID={`home-host-remove-${serverId}`}
          >
            {t("settings.host.daemon.remove.title")}
          </Button>
        )}
      </View>
    </View>
  );
}

function ProviderReadiness({ serverId }: { serverId: string }) {
  const { entries, isLoading } = useProvidersSnapshot(serverId);
  const enabled = useMemo(() => entries?.filter((entry) => entry.enabled !== false), [entries]);
  const loaded = !isLoading && enabled;
  return (
    <View style={[styles.section, settingsStyles.rowBorder]}>
      <View style={styles.row}>
        <Text style={styles.sectionLabel}>{homeCopy.providers.title}</Text>
        <ManageProvidersLink serverId={serverId} />
      </View>
      {loaded ? (
        <ProviderColumns entries={enabled} serverId={serverId} />
      ) : (
        <Text style={styles.hint}>{homeCopy.providers.checking}</Text>
      )}
    </View>
  );
}

function ProviderColumns({
  entries,
  serverId,
}: {
  entries: ProviderSnapshotEntry[];
  serverId: string;
}) {
  // Two columns from `sm` up, filled top to bottom, so a long list stays a short card.
  const half = Math.ceil(entries.length / 2);
  const columns = [entries.slice(0, half), entries.slice(half)];
  const noneReady = !entries.some((entry) => entry.status === "ready");
  return (
    <>
      <View style={styles.providerColumns}>
        {columns.map((column) => (
          <View key={column[0]?.provider ?? "empty"} style={styles.providerColumn}>
            {column.map((entry) => (
              <ProviderLine key={entry.provider} entry={entry} serverId={serverId} />
            ))}
          </View>
        ))}
      </View>
      {noneReady ? <Text style={styles.hint}>{homeCopy.providers.noneReady}</Text> : null}
    </>
  );
}

/** A quiet text link on the section's trailing rail, like a settings section header link. */
function ManageProvidersLink({ serverId }: { serverId: string }) {
  const router = useRouter();
  const open = useCallback(
    () => router.push(buildSettingsHostSectionRoute(serverId, "providers")),
    [router, serverId],
  );
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.link, pressed && styles.linkPressed],
    [],
  );
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={homeCopy.providers.manage}
      onPress={open}
      style={style}
      testID={`home-manage-providers-${serverId}`}
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
        <>
          <Text style={[styles.linkLabel, hovered && styles.linkLabelHovered]}>
            {homeCopy.providers.manage}
          </Text>
          <Text style={styles.linkCount}>{homeCopy.providers.count(ADDABLE_PROVIDER_COUNT)}</Text>
          <LinkChevron size={14} />
        </>
      )}
    </Pressable>
  );
}

const LinkChevron = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function ProviderLine({ entry, serverId }: { entry: ProviderSnapshotEntry; serverId: string }) {
  const state = providerState(entry);
  const Glyph = state.tone === "success" ? ProviderGlyph : MutedProviderGlyph;
  return (
    <View style={styles.row} testID={`home-provider-${entry.provider}`}>
      <Glyph provider={entry.provider} serverId={serverId} />
      <Text style={styles.providerName} numberOfLines={1}>
        {entry.label ?? entry.provider}
      </Text>
      <Text style={[styles.providerState, stateTextStyle(state.tone)]} numberOfLines={1}>
        {state.label}
      </Text>
    </View>
  );
}

interface GlyphProps {
  provider: string;
  serverId: string;
  size: number;
  color: string;
}

function ProviderIconGlyph({ provider, serverId, size, color }: GlyphProps) {
  const Icon = useProviderIcon(provider, serverId);
  return <Icon size={size} color={color} />;
}

const ProviderGlyph = withUnistyles(ProviderIconGlyph, (theme) => ({
  size: theme.iconSize.md,
  color: theme.colors.foreground,
}));

const MutedProviderGlyph = withUnistyles(ProviderIconGlyph, (theme) => ({
  size: theme.iconSize.md,
  color: theme.colors.foregroundMuted,
}));

function providerState(entry: ProviderSnapshotEntry): { label: string; tone: Tone } {
  if (entry.status === "ready") {
    const models = entry.models?.length ?? 0;
    return { label: homeCopy.providers.ready(models), tone: "success" };
  }
  if (entry.status === "loading") return { label: homeCopy.providers.checkingOne, tone: "muted" };
  if (entry.status === "error") return { label: homeCopy.providers.error, tone: "danger" };
  return { label: homeCopy.providers.notInstalled, tone: "warning" };
}

function Dot({ tone }: { tone: Tone }) {
  return <View style={[styles.dot, dotStyle(tone)]} />;
}

const styles = StyleSheet.create((theme) => ({
  section: { padding: theme.spacing[4], gap: theme.spacing[2] },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  hostName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  providerName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  detail: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, paddingLeft: 16 },
  recovery: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  recoveryActions: { flexDirection: "row", gap: theme.spacing[2], marginLeft: "auto" },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm, paddingLeft: 16 },
  providerColumns: {
    flexDirection: { xs: "column", sm: "row" },
    columnGap: theme.spacing[6],
    rowGap: theme.spacing[1.5],
  },
  // Equal halves side by side; stacked, each column keeps its content height.
  providerColumn: {
    flexGrow: { xs: 0, sm: 1 },
    flexBasis: { xs: "auto", sm: 0 },
    minWidth: 0,
    gap: theme.spacing[1.5],
  },
  providerState: { fontSize: theme.fontSize.sm },
  stateQuiet: { color: theme.colors.foregroundMuted },
  stateWarning: { color: theme.colors.statusWarning },
  stateDanger: { color: theme.colors.statusDanger },
  sectionLabel: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  link: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  linkPressed: { opacity: 0.7 },
  linkLabel: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  linkLabelHovered: { textDecorationLine: "underline" },
  linkCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  success: { backgroundColor: theme.colors.statusSuccess },
  warning: { backgroundColor: theme.colors.statusWarning },
  danger: { backgroundColor: theme.colors.statusDanger },
  mutedDot: { backgroundColor: theme.colors.foregroundMuted },
}));

// Read at render, never at module scope (docs/unistyles.md): the persisted theme may land later.
function dotStyle(tone: Tone) {
  if (tone === "success") return styles.success;
  if (tone === "warning") return styles.warning;
  if (tone === "danger") return styles.danger;
  return styles.mutedDot;
}

function stateTextStyle(tone: Tone) {
  if (tone === "warning") return styles.stateWarning;
  if (tone === "danger") return styles.stateDanger;
  return styles.stateQuiet;
}
