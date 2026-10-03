import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Combobox } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { useHubAccount } from "@/clisbot/hub/account-provider";
import { selectHubProfile, useHubProfiles } from "./hub-profiles";
import { HubLockIcon, hubMutedIconProps } from "./hub-ui";
import { useHubSwitchLocked } from "./hub-edit-lock";

export function HubPicker({ compact = false }: { compact?: boolean }) {
  const registry = useHubProfiles();
  const account = useHubAccount();
  const locked = useHubSwitchLocked();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchor = useRef<View | null>(null);
  const current = registry.profiles.find((profile) => profile.hubId === registry.activeId);
  const options = useMemo(
    () =>
      registry.profiles.map((profile) => ({
        id: profile.hubId,
        label: profile.label,
        description: profile.origin ?? "Encrypted relay",
      })),
    [registry.profiles],
  );
  let status = "Sign in required";
  if (account.signedIn) {
    status =
      account.connection?.accountAuthentication === "personal"
        ? "No account sign-in required"
        : `${account.signedIn.account.email} · ${account.signedIn.membership.role}`;
  } else if (account.loading) status = "Connecting…";
  else if (account.error) status = "Unavailable";
  const chevron = useMemo(
    () => (locked ? <HubLockIcon size={14} uniProps={hubMutedIconProps} /> : undefined),
    [locked],
  );
  const showPicker = useCallback(() => setOpen(true), []);
  const select = useCallback((id: string) => {
    setError(null);
    void selectHubProfile(id).catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Hub could not be selected"),
    );
  }, []);
  if (!current) return null;
  return (
    <>
      <ComboboxTrigger
        ref={anchor}
        accessibilityRole="button"
        disabled={locked}
        chevron={chevron}
        block
        style={[styles.trigger, compact && styles.compact, locked && styles.locked]}
        onPress={showPicker}
        accessibilityLabel={locked ? "Save or cancel before switching Hub" : "Switch Hub"}
        testID={compact ? "hub-title-picker" : "hub-sidebar-picker"}
      >
        <View style={[styles.dot, account.signedIn ? styles.ready : styles.pending]} />
        <View style={styles.name}>
          <Text style={styles.label} numberOfLines={1}>
            {current.label}
          </Text>
          {compact ? (
            <Text style={styles.status} numberOfLines={1}>
              {status}
            </Text>
          ) : null}
        </View>
      </ComboboxTrigger>
      <Combobox
        options={options}
        value={current.hubId}
        onSelect={select}
        open={open && !locked}
        onOpenChange={setOpen}
        anchorRef={anchor}
        searchable
        title="Switch Hub"
        searchPlaceholder="Search Hubs…"
        desktopMinWidth={260}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.status}>
          {error}
        </Text>
      ) : null}
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  trigger: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 0,
    height: 44,
    minHeight: 44,
    gap: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.lg,
  },
  compact: {
    height: 48,
    minHeight: 48,
    width: { xs: 180, md: "auto" },
    maxWidth: { xs: 180, md: 300 },
    minWidth: { xs: 120, md: 180 },
  },
  locked: { opacity: 0.5 },
  name: { flex: 1, minWidth: 0 },
  label: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  status: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    marginTop: 2,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ready: { backgroundColor: "#38764f" },
  pending: { backgroundColor: theme.colors.foregroundMuted },
}));
