import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { Plug } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useRouter } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import {
  useHostRuntimeConnectionStatus,
  useHostRuntimeLastError,
  type HostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useSessionStore } from "@/stores/session-store";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { homeCopy } from "./copy";

type Tone = "success" | "warning" | "danger" | "muted";

const CONNECTION: Record<HostRuntimeConnectionStatus, { label: string; tone: Tone }> = {
  online: { label: homeCopy.host.online, tone: "success" },
  connecting: { label: homeCopy.host.connecting, tone: "warning" },
  idle: { label: homeCopy.host.connecting, tone: "warning" },
  offline: { label: homeCopy.host.offline, tone: "danger" },
  error: { label: homeCopy.host.error, tone: "danger" },
};

/** One Host: whether it is reachable, and which providers can start an agent on it. */
export function HostReadinessCard({ serverId, label }: { serverId: string; label: string }) {
  const router = useRouter();
  const status = useHostRuntimeConnectionStatus(serverId);
  const lastError = useHostRuntimeLastError(serverId);
  const version = useSessionStore((state) => state.sessions[serverId]?.serverInfo?.version);
  const connection = CONNECTION[status];
  const openProviders = useCallback(
    () => router.push(buildSettingsHostSectionRoute(serverId, "providers")),
    [router, serverId],
  );
  return (
    <View style={styles.card} testID={`home-host-${serverId}`}>
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
      {status === "online" ? <ProviderReadiness serverId={serverId} /> : null}
      <View style={styles.actions}>
        <Button variant="outline" size="sm" leftIcon={Plug} onPress={openProviders}>
          {homeCopy.providers.manage}
        </Button>
      </View>
    </View>
  );
}

function ProviderReadiness({ serverId }: { serverId: string }) {
  const { entries, isLoading } = useProvidersSnapshot(serverId);
  const enabled = useMemo(() => entries?.filter((entry) => entry.enabled !== false), [entries]);
  if (isLoading || !enabled)
    return <Text style={styles.detail}>{homeCopy.providers.checking}</Text>;
  const ready = enabled.filter((entry) => entry.status === "ready");
  return (
    <View style={styles.providers}>
      <Text style={styles.sectionLabel}>{homeCopy.providers.title}</Text>
      {enabled.map((entry) => (
        <ProviderLine key={entry.provider} entry={entry} />
      ))}
      {ready.length === 0 ? <Text style={styles.hint}>{homeCopy.providers.noneReady}</Text> : null}
    </View>
  );
}

function ProviderLine({ entry }: { entry: ProviderSnapshotEntry }) {
  const state = providerState(entry);
  return (
    <View style={styles.row}>
      <Dot tone={state.tone} />
      <Text style={styles.providerName} numberOfLines={1}>
        {entry.label ?? entry.provider}
      </Text>
      <Text style={styles.muted}>{state.label}</Text>
    </View>
  );
}

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
  return <View style={[styles.dot, TONE_STYLE[tone]]} />;
}

const styles = StyleSheet.create((theme) => ({
  card: {
    width: "100%",
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
  },
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
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm, paddingLeft: 16 },
  providers: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
    paddingTop: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  sectionLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", marginTop: theme.spacing[1] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  success: { backgroundColor: theme.colors.statusSuccess },
  warning: { backgroundColor: theme.colors.statusWarning },
  danger: { backgroundColor: theme.colors.statusDanger },
  mutedDot: { backgroundColor: theme.colors.foregroundMuted },
}));

const TONE_STYLE = {
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
  muted: styles.mutedDot,
};
