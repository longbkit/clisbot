import { useCallback, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { MoreHorizontal, Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHubAccounts } from "@/clisbot/hub/account-provider";
import { useToast } from "@/contexts/toast-api-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { removeHubProfile, type HubProfile } from "./hub-profiles";
import { HubNetworkIcon, HubLaptopIcon, hubMutedIconProps } from "./hub-ui";
import type { DetectedHub, HostHubCheck } from "./hub-host-discovery";

import { HubStartHelp } from "./hub-start-help";
import { useHubStartStatus } from "./hub-start-status";

const MoreIcon = withUnistyles(MoreHorizontal);
type HubAccount = ReturnType<typeof useHubAccounts>[number];

/** Stable identity wins over address: different Hosts may report the same loopback URL. */
export function matchesSavedHub(hub: DetectedHub, profile: HubProfile) {
  const identity = hub.connection?.hubId ?? hub.hubId;
  return identity ? identity === profile.hubId : !hub.local && hub.origin === profile.origin;
}

function HubRow({
  name,
  detail,
  selected,
  children,
  host = false,
  testID,
}: {
  name: string;
  detail: string;
  selected?: boolean;
  children: ReactNode;
  host?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const Icon = host ? HubLaptopIcon : HubNetworkIcon;
  return (
    <View style={styles.row} testID={testID}>
      <Icon size={18} uniProps={hubMutedIconProps} />
      <View style={styles.description}>
        <View style={styles.heading}>
          <Text style={styles.name}>{name}</Text>
          {selected ? (
            <Text style={styles.selected}>{t("hub.connection.row.selected")}</Text>
          ) : null}
        </View>
        <Text style={styles.detail}>{detail}</Text>
      </View>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

export function SavedHubList({
  profiles,
  activeId,
  detected,
  localServerId,
  disabled,
  open,
  startOn,
  retry,
}: {
  profiles: HubProfile[];
  activeId: string | null;
  detected: DetectedHub[];
  localServerId: string | null;
  disabled: boolean;
  open(id: string, destination?: "account" | "connection"): Promise<void>;
  startOn(id: string): void;
  retry(): void;
}) {
  const accounts = useHubAccounts();
  return (
    <View style={settingsStyles.card}>
      {profiles.map((profile) => (
        <SavedHubRow
          key={profile.hubId}
          profile={profile}
          selected={profile.hubId === activeId}
          disabled={disabled}
          account={accounts.find((account) => account.origin === `hub://${profile.hubId}`)}
          detected={detected.find((hub) => matchesSavedHub(hub, profile))}
          localServerId={localServerId}
          open={open}
          startOn={startOn}
          retry={retry}
        />
      ))}
    </View>
  );
}

function savedHubState(account: HubAccount | undefined, stopped: boolean) {
  if (account?.signedIn) return "connected";
  if (!account || account.loading) return "connecting";
  if (stopped) return "stopped";
  if (account.error) return "unavailable";
  if (account.state?.status === "signedOut") return "signInRequired";
  return "needsAttention";
}

function SavedHubRow({
  profile,
  selected,
  account,
  detected,
  localServerId,
  disabled,
  open,
  startOn,
  retry,
}: {
  profile: HubProfile;
  selected: boolean;
  account: HubAccount | undefined;
  detected?: DetectedHub;
  localServerId: string | null;
  disabled: boolean;
  open(id: string, destination?: "account" | "connection"): Promise<void>;
  startOn(id: string): void;
  retry(): void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const availability = useHubStartStatus(detected?.serverId ?? "", localServerId);
  const host = useMemo(
    () => (detected ? { serverId: detected.serverId, label: detected.hostLabel } : null),
    [detected],
  );
  const stopped = detected?.stopped === true;
  const state = savedHubState(account, stopped);
  const canStart = state === "stopped" && detected && availability.status === "ready";
  const status =
    state === "stopped" || state === "needsAttention"
      ? t(`hub.connection.inventory.${state}`)
      : t(`hub.connection.status.${state}`);
  let where = t("hub.connection.common.encryptedRelay");
  if (profile.origin) where = new URL(profile.origin).host;
  if (detected?.local) where = detected.hostLabel;
  const detail = `${status} · ${where}`;
  let action = t("hub.connection.row.openHub");
  if (state === "needsAttention" || state === "stopped")
    action = t("hub.connection.inventory.review");
  if (state === "signInRequired") action = t("hub.connection.common.signInToHub");
  if (state === "unavailable") action = t("hub.connection.common.retry");
  if (canStart) action = t("hub.connection.unavailable.startAgain");
  const run = useCallback(() => {
    if (canStart && detected) startOn(detected.serverId);
    else if (state === "unavailable" && account)
      void account
        .refresh()
        .catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error)),
        );
    else void open(profile.hubId, account?.signedIn ? undefined : "account");
  }, [canStart, detected, startOn, state, account, open, profile.hubId, toast]);
  const edit = useCallback(() => {
    void open(profile.hubId, "connection");
  }, [open, profile.hubId]);
  const remove = useCallback(async () => {
    if (
      !(await confirmDialog({
        title: t("hub.connection.unavailable.removeTitle", { name: profile.label }),
        message: t("hub.connection.inventory.removeMessage"),
        confirmLabel: t("hub.connection.unavailable.removeConfirm"),
        destructive: true,
      }))
    )
      return;
    await removeHubProfile(profile.hubId).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error)),
    );
  }, [profile, t, toast]);
  return (
    <HubRow
      name={profile.label}
      detail={detail}
      selected={selected}
      testID={`saved-hub-${profile.hubId}`}
    >
      {state === "stopped" && !canStart && host ? (
        <HubStartHelp host={host} localServerId={localServerId} disabled={disabled} retry={retry} />
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || state === "connecting"}
          onPress={run}
        >
          {action}
        </Button>
      )}
      <DropdownMenu compactMode="sheet">
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={t("hub.connection.inventory.actions", { name: profile.label })}
          disabled={disabled}
          style={styles.menuTrigger}
        >
          <MoreIcon size={18} uniProps={hubMutedIconProps} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sheetTitle={profile.label}>
          <DropdownMenuItem disabled={disabled} onSelect={edit}>
            {t("hub.connection.overview.editConnection")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={disabled} onSelect={remove}>
            {t("hub.connection.unavailable.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </HubRow>
  );
}

export function DetectedHubList({
  hubs,
  localServerId,
  disabled,
  connect,
  startOn,
  retry,
}: {
  hubs: DetectedHub[];
  localServerId: string | null;
  disabled: boolean;
  connect(hub: DetectedHub): Promise<void>;
  startOn(id: string): void;
  retry(): void;
}) {
  const unique = [
    ...new Map(
      hubs.map((hub) => [hub.connection?.hubId ?? `${hub.serverId}:${hub.origin}`, hub]),
    ).values(),
  ];
  return (
    <View style={settingsStyles.card}>
      {unique.map((hub) => (
        <DetectedHubRow
          key={hub.connection?.hubId ?? hub.serverId}
          hub={hub}
          localServerId={localServerId}
          disabled={disabled}
          connect={connect}
          startOn={startOn}
          retry={retry}
        />
      ))}
    </View>
  );
}

function DetectedHubRow({
  hub,
  localServerId,
  disabled,
  connect,
  startOn,
  retry,
}: {
  hub: DetectedHub;
  localServerId: string | null;
  disabled: boolean;
  connect(hub: DetectedHub): Promise<void>;
  startOn(id: string): void;
  retry(): void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const availability = useHubStartStatus(hub.serverId, localServerId);
  const host = useMemo(
    () => ({ serverId: hub.serverId, label: hub.hostLabel }),
    [hub.serverId, hub.hostLabel],
  );
  const canStart = availability.status === "ready";
  const run = useCallback(() => {
    if (!hub.stopped) void connect(hub);
    else if (canStart) startOn(hub.serverId);
    else router.push(`/settings/hosts/${hub.serverId}/host`);
  }, [hub, connect, canStart, startOn, router]);
  let action = t("hub.connection.common.connect");
  if (hub.stopped)
    action = canStart
      ? t("hub.connection.unavailable.startAgain")
      : t("hub.connection.inventory.viewHost");
  return (
    <HubRow
      name={
        hub.local
          ? t("hub.connection.row.hubOnHost", { host: hub.hostLabel })
          : new URL(hub.origin).host
      }
      detail={
        hub.stopped ? t("hub.connection.unavailable.stopped") : t("hub.connection.row.detected")
      }
    >
      {hub.stopped && !canStart ? (
        <HubStartHelp host={host} localServerId={localServerId} disabled={disabled} retry={retry} />
      ) : (
        <Button size="sm" variant="outline" disabled={disabled} onPress={run}>
          {action}
        </Button>
      )}
    </HubRow>
  );
}

export function HubStartHosts({
  hosts,
  connectedIds,
  checks,
  connectHost,
  localServerId,
  disabled,
  startOn,
  retry,
}: {
  hosts: HostProfile[];
  connectedIds: string[];
  checks: Record<string, HostHubCheck>;
  connectHost(): void;
  localServerId: string | null;
  disabled: boolean;
  startOn(id: string): void;
  retry(): void;
}) {
  const candidates = hosts.filter((host) => {
    const check = checks[host.serverId];
    return !(check?.kind === "ready" && check.hub?.local);
  });
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t("hub.connection.inventory.runOnHosts")}</Text>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={Plus}
          style={styles.connectAction}
          disabled={disabled}
          onPress={connectHost}
        >
          {t("hub.connection.inventory.connectHost")}
        </Button>
      </View>
      {candidates.length ? (
        <View style={settingsStyles.card}>
          {candidates.map((host) => (
            <StartHostRow
              key={host.serverId}
              host={host}
              online={connectedIds.includes(host.serverId)}
              check={checks[host.serverId]}
              localServerId={localServerId}
              disabled={disabled}
              startOn={startOn}
              retry={retry}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.detail}>
          {t(
            hosts.length
              ? "hub.connection.startHelp.alreadyListed"
              : "hub.connection.inventory.connectHostHint",
            { hosts: hosts.map((host) => host.label).join(", ") },
          )}
        </Text>
      )}
    </View>
  );
}

function StartHostRow({
  host,
  online,
  check,
  localServerId,
  disabled,
  startOn,
  retry,
}: {
  host: HostProfile;
  online: boolean;
  check?: HostHubCheck;
  localServerId: string | null;
  disabled: boolean;
  startOn(id: string): void;
  retry(): void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const availability = useHubStartStatus(host.serverId, localServerId);
  const canStart =
    online && check?.kind === "ready" && !check.hub && availability.status === "ready";
  const state = startHostState(online, check, canStart);
  let detail = t(`hub.connection.inventory.${state}`);
  if (
    online &&
    !canStart &&
    state !== "checking" &&
    state !== "failed" &&
    availability.status !== "ready"
  ) {
    const reason = availability.status === "blocked" ? availability.reason : "unknown";
    detail = t(`hub.connection.startHelp.reasons.${reason}`);
  }
  let action = t("hub.connection.inventory.viewHost");
  if (state === "failed") action = t("hub.connection.common.retry");
  if (canStart) action = t("hub.connection.unavailable.startAgain");
  const run = useCallback(() => {
    if (canStart) startOn(host.serverId);
    else if (state === "failed") retry();
    else router.push(`/settings/hosts/${host.serverId}/host`);
  }, [canStart, startOn, host.serverId, state, retry, router]);
  return (
    <HubRow host name={host.label} detail={detail} testID={`hub-host-${host.serverId}`}>
      {canStart || state === "checking" || state === "failed" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || state === "checking"}
          onPress={run}
        >
          {action}
        </Button>
      ) : (
        <HubStartHelp host={host} localServerId={localServerId} disabled={disabled} retry={retry} />
      )}
    </HubRow>
  );
}

function startHostState(online: boolean, check: HostHubCheck | undefined, canStart: boolean) {
  if (!online) return "offline";
  if (!check || check.kind === "checking") return "checking";
  if (check.kind === "failed" || check.kind === "unsupported") return check.kind;
  return canStart ? "noHub" : "ownerRequired";
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  description: { flex: 1, minWidth: 140, gap: theme.spacing[1] },
  heading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing[2] },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  detail: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, lineHeight: 18 },
  selected: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: "auto",
  },
  menuTrigger: {
    width: { xs: 48, md: 32 },
    height: { xs: 48, md: 32 },
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  section: { gap: theme.spacing[3] },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  connectAction: { alignSelf: "flex-start", minHeight: { xs: 44, md: 32 } },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
