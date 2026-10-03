import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronRight, Info } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { hubMutedIconProps } from "./hub-ui";
const ThemedInfo = withUnistyles(Info);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

const KEY = "clisbot:hub-help-expanded:v1";
let expanded = true;
let ready: Promise<void> | undefined;
const listeners = new Set<() => void>();
let revision = 0;
function emit() {
  for (const listener of listeners) listener();
}
export function WhatIsHub() {
  const open = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => expanded,
    () => true,
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
        accessibilityLabel="What is a Hub?"
        style={styles.heading}
      >
        <ThemedInfo size={14} uniProps={hubMutedIconProps} />
        <Text style={styles.label}>What is a Hub?</Text>
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
          <Text style={styles.copy}>
            A Hub manages channels, automations and shared Host access.
          </Text>
          <View style={styles.bullets}>
            <Text style={styles.copy}>
              • <Text style={styles.strong}>Agents only:</Text> connect a Host. No Hub needed.
            </Text>
            <Text style={styles.copy}>
              • <Text style={styles.strong}>Slack, Telegram or automations:</Text> run your own Hub
              on a Host, or use an existing Hub.
            </Text>
            <Text style={styles.copy}>
              • <Text style={styles.strong}>Team access:</Text> connect the Hub your team provides.
            </Text>
          </View>
        </View>
      ) : null}
      {error ? (
        <Text style={styles.copy}>Your help preference could not be saved on this device.</Text>
      ) : null}
    </View>
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
