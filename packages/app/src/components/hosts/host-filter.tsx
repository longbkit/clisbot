import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, Server } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import {
  ALL_HOSTS_OPTION_ID,
  getHostPickerLabel,
  HostPicker,
  HostStatusDotSlot,
  type HostPickerHost,
} from "@/components/hosts/host-picker";

const ThemedServer = withUnistyles(Server);
const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface HostFilterProps {
  hosts: HostPickerHost[];
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  /**
   * Offer "All hosts". Off for a surface that acts on exactly one host's data — the label
   * manager edits a single host's catalog, so "all" is not an answer it could carry out.
   */
  includeAllHost?: boolean;
  triggerTestID?: string;
  hostOptionTestID?: (serverId: string) => string;
}

/**
 * The "All hosts / <host>" host pill shared by History, Schedules, Usage, the label manager and
 * plugin screens: an anchored HostPicker, hidden by the caller when only one host exists. Without
 * `includeAllHost` it picks the one host a surface shows.
 */
export function HostFilter({
  hosts,
  selectedHost,
  onSelectHost,
  includeAllHost = true,
  triggerTestID,
  hostOptionTestID,
}: HostFilterProps): ReactElement {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterAnchorRef = useRef<View>(null);

  const selectedHostLabel = useMemo(
    () => getHostPickerLabel(hosts, selectedHost, { includeAllHost }),
    [hosts, includeAllHost, selectedHost],
  );

  const handleFilterOpen = useCallback(() => setIsFilterOpen(true), []);
  const leading = useMemo(
    () =>
      selectedHost === ALL_HOSTS_OPTION_ID ? (
        <ThemedServer size={14} uniProps={mutedColorMapping} />
      ) : (
        <HostStatusDotSlot serverId={selectedHost} />
      ),
    [selectedHost],
  );

  return (
    <HostPicker
      hosts={hosts}
      value={selectedHost}
      onSelect={onSelectHost}
      open={isFilterOpen}
      onOpenChange={setIsFilterOpen}
      anchorRef={filterAnchorRef}
      includeAllHost={includeAllHost}
      searchable={false}
      title="Filter by host"
      desktopPlacement="bottom-start"
      hostOptionTestID={hostOptionTestID}
    >
      <FilterPill
        anchorRef={filterAnchorRef}
        onPress={handleFilterOpen}
        testID={triggerTestID}
        accessibilityLabel={`Filter: ${selectedHostLabel}`}
        label={selectedHostLabel}
        leading={leading}
      />
    </HostPicker>
  );
}

/**
 * The filter pill a list screen puts beside its search: label, chevron, and an optional leading
 * glyph. HostFilter draws its trigger with it, and so does any other filter on the same row.
 */
export function FilterPill({
  anchorRef,
  label,
  leading,
  onPress,
  testID,
  accessibilityLabel,
}: {
  anchorRef: RefObject<View | null>;
  label: string;
  leading?: ReactNode;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}): ReactElement {
  return (
    <View ref={anchorRef} collapsable={false} style={styles.filterTriggerWrap}>
      <Pressable
        onPress={onPress}
        style={filterTriggerStyle}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        {leading}
        <Text style={styles.filterTriggerText} numberOfLines={1}>
          {label}
        </Text>
        <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
      </Pressable>
    </View>
  );
}

function filterTriggerStyle({
  pressed,
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.filterTrigger,
    Boolean(hovered) && styles.filterTriggerHovered,
    pressed && styles.filterTriggerPressed,
  ];
}

const styles = StyleSheet.create((theme) => ({
  filterTriggerWrap: {
    alignSelf: "flex-start",
  },
  filterTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceComposer,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  filterTriggerHovered: {
    backgroundColor: theme.colors.surface1,
  },
  filterTriggerPressed: {
    backgroundColor: theme.colors.surface2,
  },
  filterTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));
