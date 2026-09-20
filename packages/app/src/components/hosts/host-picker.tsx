import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { Plus, Server, Settings } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { HostStatusDot } from "@/components/host-status-dot";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostRuntimeSnapshot, useHosts, type ActiveConnection } from "@/runtime/host-runtime";
import {
  isManagedAccessHost,
  MANAGED_ACCESS_HOST_LABEL,
  MANAGED_ACCESS_HOST_TOOLTIP,
} from "@/hosts/managed-access";
import { ManagedAccessIcon } from "@/hosts/managed-access-icon";
import { orderHostsLocalFirst } from "@/types/host-connection";
import {
  ADD_HOST_OPTION_ID,
  ALL_HOSTS_OPTION_ID,
  ENABLE_BUILT_IN_DAEMON_OPTION_ID,
  shouldSearchHostPicker,
} from "./host-picker-constants";

export {
  ADD_HOST_OPTION_ID,
  ALL_HOSTS_OPTION_ID,
  ENABLE_BUILT_IN_DAEMON_OPTION_ID,
  getHostFilterPickerValue,
  getHostPickerLabel,
  HOST_PICKER_SEARCHABLE_THRESHOLD,
  shouldSearchHostPicker,
} from "./host-picker-constants";

type RenderHostOption = NonNullable<ComboboxProps["renderOption"]>;
interface HostPickerHost {
  serverId: string;
  label: string;
}

export function HostStatusDotSlot({ serverId }: { serverId: string }): ReactElement {
  return (
    <View style={styles.statusDotSlot}>
      <HostStatusDot serverId={serverId} />
    </View>
  );
}

function ManagedAccessGlyph({ serverId }: { serverId: string }): ReactElement {
  const { theme } = useUnistyles();
  const handlePress = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger
        onPress={handlePress}
        accessibilityLabel={MANAGED_ACCESS_HOST_LABEL}
        testID={`host-picker-managed-${serverId}`}
      >
        <ManagedAccessIcon size={theme.iconSize.sm} />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={6}>
        <Text style={styles.managedAccessTooltip}>{MANAGED_ACCESS_HOST_TOOLTIP}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Settings lives on its own hit target so a press on the host row can filter without opening
 * configuration. Hover is tracked on a plain View so it does not fight the row Pressable.
 */
function HostSettingsButton({
  label,
  onPress,
}: {
  label: string;
  onPress: (event: GestureResponderEvent) => void;
}): ReactElement {
  const { theme } = useUnistyles();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => {
    setHovered(false);
    setPressed(false);
  }, []);
  const handlePressIn = useCallback(() => setPressed(true), []);
  const handlePressOut = useCallback(() => setPressed(false), []);

  return (
    <View
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={[styles.settingsButton, (hovered || pressed) && styles.settingsButtonHighlighted]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={`Open ${label} settings`}
        style={styles.settingsButtonHit}
      >
        <Settings size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

// Standard secure/plain web ports carry no information in the host display, so
// "relay.paseo.sh:443" reads as "relay.paseo.sh" while "127.0.0.1:6767" is kept.
function formatConnectionEndpoint(endpoint: string): string {
  return endpoint.replace(/:(?:443|80)$/, "");
}

// Socket/pipe transports have no host:port — their endpoint is a filesystem
// path, so they read as "Local". TCP and relay show the address being used.
function formatActiveConnectionLabel(connection: ActiveConnection): string {
  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return "Local";
  }
  return formatConnectionEndpoint(connection.endpoint);
}

export interface HostPickerOptionProps {
  serverId: string;
  label: string;
  showActiveConnection: boolean;
  selected?: boolean;
  active: boolean;
  onPress: () => void;
  onOpenHostSettings?: (serverId: string) => void;
  testID?: string;
}

export function HostPickerOption({
  serverId,
  label,
  showActiveConnection,
  selected,
  active,
  onPress,
  onOpenHostSettings,
  testID,
}: HostPickerOptionProps): ReactElement {
  const activeConnection = useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;
  const connectionLabel =
    showActiveConnection && activeConnection
      ? formatActiveConnectionLabel(activeConnection)
      : undefined;
  const leadingSlot = useMemo(() => <HostStatusDotSlot serverId={serverId} />, [serverId]);
  const managedAccess = isManagedAccessHost(useHosts().find((host) => host.serverId === serverId));
  const handleSettingsPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onOpenHostSettings?.(serverId);
    },
    [onOpenHostSettings, serverId],
  );
  const trailingSlot = useMemo(() => {
    const managedIcon = managedAccess ? <ManagedAccessGlyph serverId={serverId} /> : null;
    if (!onOpenHostSettings) return managedIcon ?? undefined;
    return (
      <View style={styles.trailing}>
        {managedIcon}
        <HostSettingsButton label={label} onPress={handleSettingsPress} />
      </View>
    );
  }, [handleSettingsPress, label, managedAccess, onOpenHostSettings, serverId]);

  return (
    <ComboboxItem
      label={label}
      description={hostOptionDescription(managedAccess, connectionLabel)}
      leadingSlot={leadingSlot}
      trailingSlot={trailingSlot}
      selected={selected}
      active={active}
      onPress={onPress}
      testID={testID}
    />
  );
}

const SYSTEM_HOST_PICKER_OPTION_LABELS: Record<"add" | "all" | "enableBuiltInDaemon", string> = {
  add: "Add host",
  all: "All hosts",
  enableBuiltInDaemon: "Enable built-in daemon",
};

function SystemHostPickerOption({
  active,
  selected,
  onPress,
  kind,
  testID,
}: {
  active: boolean;
  selected?: boolean;
  onPress: () => void;
  kind: "add" | "all" | "enableBuiltInDaemon";
  testID?: string;
}): ReactElement {
  const { theme } = useUnistyles();
  const Icon = kind === "add" ? Plus : Server;
  const label = SYSTEM_HOST_PICKER_OPTION_LABELS[kind];
  const leadingSlot = useMemo(
    () => <Icon size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    [Icon, theme.colors.foregroundMuted, theme.iconSize.sm],
  );

  return (
    <ComboboxItem
      label={label}
      leadingSlot={leadingSlot}
      selected={selected}
      active={active}
      onPress={onPress}
      testID={testID}
    />
  );
}

export interface HostPickerProps {
  hosts: HostPickerHost[];
  value: string;
  onSelect: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<View | null>;
  includeAllHost?: boolean;
  includeAddHost?: boolean;
  onAddHost?: () => void;
  includeEnableBuiltInDaemon?: boolean;
  onEnableBuiltInDaemon?: () => void;
  showActiveConnection?: boolean;
  onOpenHostSettings?: (serverId: string) => void;
  searchable?: boolean;
  title?: string;
  desktopPlacement?: ComboboxProps["desktopPlacement"];
  desktopMinWidth?: number;
  addHostTestID?: string;
  hostOptionTestID?: (serverId: string) => string;
  children: ReactNode;
}

export function HostPicker({
  hosts,
  value,
  onSelect,
  open,
  onOpenChange,
  anchorRef,
  includeAllHost,
  includeAddHost,
  onAddHost,
  includeEnableBuiltInDaemon,
  onEnableBuiltInDaemon,
  showActiveConnection,
  onOpenHostSettings,
  searchable,
  title,
  desktopPlacement = "bottom-start",
  desktopMinWidth,
  addHostTestID,
  hostOptionTestID,
  children,
}: HostPickerProps): ReactElement {
  const localServerId = useLocalDaemonServerId();
  const orderedHosts = useMemo(
    () => orderHostsLocalFirst(hosts, localServerId),
    [hosts, localServerId],
  );

  const options = useMemo(() => {
    const hostOptions = orderedHosts.map((host) => ({ id: host.serverId, label: host.label }));
    if (includeAllHost) hostOptions.unshift({ id: ALL_HOSTS_OPTION_ID, label: "All hosts" });
    if (includeAddHost) hostOptions.push({ id: ADD_HOST_OPTION_ID, label: "Add host" });
    if (includeEnableBuiltInDaemon)
      hostOptions.push({
        id: ENABLE_BUILT_IN_DAEMON_OPTION_ID,
        label: "Enable built-in daemon",
      });
    return hostOptions;
  }, [orderedHosts, includeAllHost, includeAddHost, includeEnableBuiltInDaemon]);

  const isSearchable = shouldSearchHostPicker(orderedHosts.length, searchable);

  const handleSelect = useCallback(
    (id: string) => {
      if (id === ADD_HOST_OPTION_ID) {
        onAddHost?.();
      } else if (id === ENABLE_BUILT_IN_DAEMON_OPTION_ID) {
        onEnableBuiltInDaemon?.();
      } else {
        onSelect(id);
      }
      onOpenChange(false);
    },
    [onAddHost, onEnableBuiltInDaemon, onOpenChange, onSelect],
  );

  const handleOpenHostSettings = useCallback(
    (serverId: string) => {
      onOpenHostSettings?.(serverId);
      onOpenChange(false);
    },
    [onOpenHostSettings, onOpenChange],
  );

  const renderOption = useCallback<RenderHostOption>(
    ({ option, selected, active, onPress }) => {
      if (option.id === ADD_HOST_OPTION_ID) {
        return (
          <SystemHostPickerOption
            kind="add"
            active={active}
            onPress={onPress}
            testID={addHostTestID}
          />
        );
      }
      if (option.id === ALL_HOSTS_OPTION_ID) {
        return (
          <SystemHostPickerOption
            kind="all"
            active={active}
            selected={selected}
            onPress={onPress}
            testID={hostOptionTestID?.(option.id)}
          />
        );
      }
      if (option.id === ENABLE_BUILT_IN_DAEMON_OPTION_ID) {
        return (
          <SystemHostPickerOption kind="enableBuiltInDaemon" active={active} onPress={onPress} />
        );
      }
      return (
        <HostPickerOption
          serverId={option.id}
          label={option.label}
          showActiveConnection={showActiveConnection === true}
          selected={selected}
          active={active}
          onPress={onPress}
          onOpenHostSettings={onOpenHostSettings ? handleOpenHostSettings : undefined}
          testID={hostOptionTestID?.(option.id)}
        />
      );
    },
    [
      addHostTestID,
      hostOptionTestID,
      onOpenHostSettings,
      showActiveConnection,
      handleOpenHostSettings,
    ],
  );

  return (
    <>
      {children}
      <Combobox
        options={options}
        value={value}
        onSelect={handleSelect}
        renderOption={renderOption}
        searchable={isSearchable}
        searchPlaceholder="Search hosts"
        title={title ?? "Host"}
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={anchorRef}
        desktopPlacement={desktopPlacement}
        desktopMinWidth={desktopMinWidth}
      />
    </>
  );
}

/** A managed access Host names how it is reached before the endpoint, so the row reads the same
 * whether or not the active connection is shown. */
function hostOptionDescription(
  managedAccess: boolean,
  connectionLabel: string | undefined,
): string | undefined {
  if (!managedAccess) return connectionLabel;
  return connectionLabel
    ? `${MANAGED_ACCESS_HOST_LABEL} · ${connectionLabel}`
    : MANAGED_ACCESS_HOST_LABEL;
}

const styles = StyleSheet.create((theme) => ({
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  statusDotSlot: {
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsButtonHit: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsButtonHighlighted: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  managedAccessTooltip: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
