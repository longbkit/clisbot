import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronRight, Info } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { hubMutedIconProps } from "./hub-ui";
const ThemedInfo = withUnistyles(Info);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

const KEY = "clisbot:hub-help-expanded:v1";
let expanded = false;
let ready: Promise<void> | undefined;
const listeners = new Set<() => void>();
let revision = 0;
function emit() {
  for (const listener of listeners) listener();
}
export function WhatIsHub() {
  const { t } = useTranslation();
  const open = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => expanded,
    () => false,
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    const initialRevision = revision;
    ready ??= AsyncStorage.getItem(KEY).then((value) => {
      if (revision === initialRevision && value !== null) {
        expanded = value !== "false";
        emit();
      }
      return undefined;
    });
    void ready.catch(() => setError(true));
  }, []);
  const disclosure = useMemo(() => ({ expanded: open }), [open]);
  const toggle = useCallback(() => {
    revision++;
    expanded = !expanded;
    emit();
    void AsyncStorage.setItem(KEY, String(expanded)).catch(() => setError(true));
  }, []);
  return (
    <View style={styles.help}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={disclosure}
        aria-expanded={open}
        accessibilityLabel={t("hub.connection.help.title")}
        style={styles.heading}
      >
        <ThemedInfo size={14} uniProps={hubMutedIconProps} />
        <Text style={styles.label}>{t("hub.connection.help.title")}</Text>
        <View style={styles.chevron}>
          {open ? (
            <ThemedChevronDown size={14} uniProps={hubMutedIconProps} />
          ) : (
            <ThemedChevronRight size={14} uniProps={hubMutedIconProps} />
          )}
        </View>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <Text style={styles.copy}>{t("hub.connection.help.intro")}</Text>
          <View style={styles.bullets}>
            <HelpBullet
              label={t("hub.connection.help.agentsOnlyLabel")}
              body={t("hub.connection.help.agentsOnly")}
            />
            <HelpBullet
              label={t("hub.connection.help.channelsLabel")}
              body={t("hub.connection.help.channels")}
            />
            <HelpBullet
              label={t("hub.connection.help.teamLabel")}
              body={t("hub.connection.help.team")}
            />
          </View>
          <Text style={styles.context}>{t("hub.connection.list.switchNote")}</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.copy}>{t("hub.connection.help.saveFailed")}</Text> : null}
    </View>
  );
}
function HelpBullet({ label, body }: { label: string; body: string }) {
  return (
    <Text style={styles.copy}>
      • <Text style={styles.strong}>{label}</Text> {body}
    </Text>
  );
}
const styles = StyleSheet.create((theme) => ({
  // Help text, not a setting: a border without a fill, so it reads quieter than the settings
  // cards around it.
  help: {
    marginBottom: theme.spacing[6],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 40,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  chevron: { marginLeft: "auto" },
  body: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
  context: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    marginTop: theme.spacing[3],
  },
  bullets: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[1],
  },
  strong: {
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  copy: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
  },
}));
