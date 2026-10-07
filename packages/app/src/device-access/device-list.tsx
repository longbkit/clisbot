import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { MoreHorizontal, Pencil, QrCode, RefreshCw, Trash2 } from "lucide-react-native";
import { HubText as Text } from "./hub-text";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { HubLaptopIcon, hubMutedIconProps, HubContextNote } from "./hub-ui";
import { useHubEditLock } from "./hub-edit-lock";

interface Device {
  id: string;
  label: string;
  revokedAt: number | null;
  lastSeenAt: number | null;
  sessions?: { connected: boolean }[];
}
type DeviceAction =
  | { kind: "list" }
  | { kind: "rename"; deviceId: string; label: string }
  | { kind: "revoke"; deviceId: string };

export function PairedDeviceList({
  request,
  lockHubSwitch = false,
  currentDeviceId,
  onPairDevice,
  children,
}: {
  request(action: DeviceAction): Promise<{ devices: Device[] }>;
  lockHubSwitch?: boolean;
  currentDeviceId?: string;
  /** Offered where this list can also invite a device. */
  onPairDevice?: () => void;
  /** Shown above the list, e.g. the invitation just created. */
  children?: ReactNode;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (action: DeviceAction) => {
      setBusy(true);
      setError(null);
      try {
        setDevices((await request(action)).devices);
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Device operation failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [request],
  );
  const refresh = useCallback(() => {
    void run({ kind: "list" });
  }, [run]);
  useEffect(() => {
    void run({ kind: "list" });
  }, [run]);
  const revokeAll = useRevokeAll(devices, currentDeviceId, request, setDevices, setError, setBusy);
  const headerActions = useMemo(
    () => (
      <View style={styles.headerActions}>
        {revokeAll.count > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            leftIcon={Trash2}
            disabled={busy}
            onPress={revokeAll.start}
          >
            {revokeAll.label}
          </Button>
        ) : null}
        <Button variant="ghost" size="xs" leftIcon={RefreshCw} disabled={busy} onPress={refresh}>
          Refresh
        </Button>
        {onPairDevice ? (
          <Button variant="ghost" size="xs" leftIcon={QrCode} onPress={onPairDevice}>
            Pair a device
          </Button>
        ) : null}
      </View>
    ),
    [busy, refresh, revokeAll, onPairDevice],
  );
  return (
    <SettingsSection title="Paired devices" trailing={headerActions}>
      {children}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <View style={settingsStyles.card}>
        {devices.map((device, index) => (
          <PairedDeviceRow
            key={device.id}
            device={device}
            busy={busy}
            run={run}
            lockHubSwitch={lockHubSwitch}
            current={device.id === currentDeviceId}
            bordered={index > 0}
          />
        ))}
      </View>
      <HubContextNote>
        Revoke pairing to remove a device&apos;s access to this service. Hub and Host pairings are
        separate; running agents continue.
      </HubContextNote>
    </SettingsSection>
  );
}

/**
 * Revoke every active device except the one in use, when the list knows which that is. Without
 * it (a Host's list) every device goes, and the confirmation says this one may lose access too.
 */
function useRevokeAll(
  devices: Device[],
  currentDeviceId: string | undefined,
  request: (action: DeviceAction) => Promise<{ devices: Device[] }>,
  setDevices: (devices: Device[]) => void,
  setError: (error: string | null) => void,
  setBusy: (busy: boolean) => void,
) {
  const targets = devices.filter((device) => !device.revokedAt && device.id !== currentDeviceId);
  const keepsCurrent = currentDeviceId !== undefined;
  const count = targets.length;
  const start = useCallback(() => {
    const ids = targets.map((device) => device.id);
    void confirmAndRevoke(ids, keepsCurrent, {
      request,
      setDevices,
      setError,
      setBusy,
    });
    // targets is rebuilt each render; its ids are what the confirmation counts.
  }, [targets, keepsCurrent, request, setDevices, setError, setBusy]);
  return { count, start, label: keepsCurrent ? "Revoke others" : "Revoke all" };
}

async function confirmAndRevoke(
  ids: string[],
  keepsCurrent: boolean,
  io: {
    request: (action: DeviceAction) => Promise<{ devices: Device[] }>;
    setDevices: (devices: Device[]) => void;
    setError: (error: string | null) => void;
    setBusy: (busy: boolean) => void;
  },
) {
  const confirmed = await confirmDialog({
    title: keepsCurrent
      ? `Revoke ${ids.length} other devices?`
      : `Revoke all ${ids.length} devices?`,
    message: keepsCurrent
      ? "Every other device loses access to this service and its connections close. This device stays paired. Running agents continue."
      : "Every device loses access to this service and its connections close, including this one if it is in the list. Running agents continue.",
    confirmLabel: "Revoke all",
    destructive: true,
  });
  if (!confirmed) return;
  io.setBusy(true);
  io.setError(null);
  try {
    for (const deviceId of ids)
      io.setDevices((await io.request({ kind: "revoke", deviceId })).devices);
  } catch (caught) {
    io.setError(caught instanceof Error ? caught.message : "Device operation failed");
  } finally {
    io.setBusy(false);
  }
}

function PairedDeviceRow({
  device,
  busy,
  run,
  lockHubSwitch,
  current,
  bordered,
}: {
  device: Device;
  busy: boolean;
  run(action: DeviceAction): Promise<boolean>;
  lockHubSwitch: boolean;
  current: boolean;
  bordered: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(device.label);
  const [resetKey, setResetKey] = useState(0);
  useHubEditLock(lockHubSwitch && (editing || busy));
  const beginRename = useCallback(() => {
    setLabel(device.label);
    setResetKey((key) => key + 1);
    setEditing(true);
  }, [device.label]);
  const cancelLabel = useCallback(() => {
    setLabel(device.label);
    setResetKey((key) => key + 1);
    setEditing(false);
  }, [device.label]);
  const saveLabel = useCallback(() => {
    void run({ kind: "rename", deviceId: device.id, label: label.trim() }).then((saved) => {
      if (saved) setEditing(false);
      return undefined;
    });
  }, [run, device.id, label]);
  const revoke = useCallback(() => {
    void confirmDialog({
      title: `Revoke ${device.label}?`,
      message:
        "This removes this device's access to this backend and closes its active connections. A daemon and Hub have separate credentials; revoke each service when needed. Running agents continue.",
      confirmLabel: "Revoke device",
      destructive: true,
    }).then((confirmed) => {
      if (confirmed) return run({ kind: "revoke", deviceId: device.id });
      return undefined;
    });
  }, [run, device.id, device.label]);
  let activity = "Not connected yet";
  if (device.revokedAt) activity = "Pairing revoked";
  else if (device.lastSeenAt)
    activity = `Last active ${new Date(device.lastSeenAt).toLocaleString()}`;
  const connections = device.sessions?.filter((session) => session.connected).length;
  const meta = [
    activity,
    connections ? `${connections} connected` : null,
    `Device ${device.id.slice(0, 8)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={[styles.row, bordered && settingsStyles.rowBorder]}>
      <View style={styles.heading}>
        <HubLaptopIcon size={18} uniProps={hubMutedIconProps} />
        <View style={styles.copy}>
          <Text style={styles.title}>
            {device.label}
            {current ? " · This device" : ""}
          </Text>
          <Text style={styles.hint}>{meta}</Text>
        </View>
        {!editing && !device.revokedAt ? (
          <DeviceMenu
            label={device.label}
            disabled={busy}
            onRename={beginRename}
            onRevoke={revoke}
          />
        ) : null}
      </View>
      {editing ? (
        <View style={styles.editor}>
          <Field
            label="Device label"
            hint="A label is for recognition only; it does not change identity or permissions."
          >
            <FormTextInput
              initialValue={label}
              onChangeText={setLabel}
              accessibilityLabel="Device label"
              resetKey={resetKey}
              editable={!busy}
            />
          </Field>
          <View style={styles.actions}>
            <Button size="sm" variant="secondary" disabled={busy} onPress={cancelLabel}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={busy || !label.trim() || label.trim() === device.label}
              onPress={saveLabel}
            >
              Save label
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Row actions live in one menu, as on every settings list (docs/design.md, kebab menus). */
function DeviceMenu({
  label,
  disabled,
  onRename,
  onRevoke,
}: {
  label: string;
  disabled: boolean;
  onRename: () => void;
  onRevoke: () => void;
}) {
  const menuLabel = `${label} options`;
  // Every item carries an icon so the labels share one rail.
  const renameIcon = useMemo(() => <Pencil size={16} color={styles.menuIcon.color} />, []);
  const revokeIcon = useMemo(() => <Trash2 size={16} color={styles.dangerIcon.color} />, []);
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={menuLabel}
        disabled={disabled}
        hitSlop={8}
        style={styles.menuButton}
      >
        <MoreHorizontal size={18} color={styles.menuIcon.color} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={200} sheetTitle={menuLabel}>
        <DropdownMenuItem leading={renameIcon} onSelect={onRename}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem destructive leading={revokeIcon} onSelect={onRevoke}>
          Revoke device
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DaemonPairedDevices({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const canManage = useSessionStore((state) => {
    const info = state.sessions[serverId]?.serverInfo;
    return (
      info?.features?.devicePairing === true && info.permissions?.includes("access.manage") === true
    );
  });
  const request = useCallback(
    (action: DeviceAction) => {
      if (!client) return Promise.reject(new Error("Connect to this Host first"));
      return client.devices(action);
    },
    [client],
  );
  if (!canManage) return null;
  return <PairedDeviceList request={request} />;
}

const styles = StyleSheet.create((theme) => ({
  row: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: theme.fontSize.base, lineHeight: 20 },
  hint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    color: theme.colors.foregroundMuted,
    marginTop: 2,
  },
  headerActions: { flexDirection: "row", gap: theme.spacing[1] },
  menuButton: { padding: theme.spacing[1], borderRadius: theme.borderRadius.sm },
  menuIcon: { color: theme.colors.foregroundMuted },
  dangerIcon: { color: theme.colors.statusDanger },
  editor: { gap: theme.spacing[3] },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
