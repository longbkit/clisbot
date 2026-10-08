import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { useHubAccount } from "@/clisbot/hub/account-provider";
import { selectHubProfile, useHubProfiles } from "./hub-profiles";
import { HubLockIcon, hubMutedIconProps } from "./hub-ui";
import { useHubSwitchLocked } from "./hub-edit-lock";

export function HubPicker({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
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
        description: profile.origin ?? t("hub.connection.common.encryptedRelay"),
      })),
    [registry.profiles, t],
  );
  let status = t("hub.connection.status.signInRequired");
  if (account.signedIn) {
    status =
      account.connection?.accountAuthentication === "personal"
        ? t("hub.connection.common.noAccountSignIn")
        : `${account.signedIn.account.email} · ${account.signedIn.membership.role}`;
  } else if (account.loading) status = t("hub.connection.status.connecting");
  else if (account.error) status = t("hub.connection.status.unavailable");
  const chevron = useMemo(
    () => (locked ? <HubLockIcon size={14} uniProps={hubMutedIconProps} /> : undefined),
    [locked],
  );
  const showPicker = useCallback(() => setOpen(true), []);
  const select = useCallback(
    (id: string) => {
      setError(null);
      void selectHubProfile(id).catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : t("hub.connection.errors.couldNotSelect"),
        ),
      );
    },
    [t],
  );
  if (!current) return null;
  return (
    <>
      <ComboboxTrigger
        ref={anchor}
        accessibilityRole="button"
        disabled={locked}
        chevron={chevron}
        block
        style={[styles.trigger, compact ? styles.compact : styles.sidebar, locked && styles.locked]}
        onPress={showPicker}
        accessibilityLabel={
          locked ? t("hub.connection.picker.lockedA11y") : t("hub.connection.picker.switch")
        }
        testID={compact ? "hub-title-picker" : "hub-sidebar-picker"}
      >
        {/* In the sidebar the dot takes an icon's room, so the name lines up
            with the items under it, as the Host picker's does. */}
        <View style={compact ? undefined : styles.dotBox}>
          <View style={[styles.dot, account.signedIn ? styles.ready : styles.pending]} />
        </View>
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
        title={t("hub.connection.picker.switch")}
        searchPlaceholder={t("hub.connection.picker.search")}
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
  // The Host picker's sidebar row (settings-screen `pickerTrigger`).
  sidebar: {
    height: { xs: 44, md: 28 },
    minHeight: { xs: 44, md: 28 },
    paddingVertical: { xs: 0, md: theme.spacing[1] },
  },
  dotBox: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
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
