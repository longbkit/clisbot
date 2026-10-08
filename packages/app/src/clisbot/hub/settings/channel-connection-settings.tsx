// The Connection page below its Routes: a list of settings rows, each showing
// its current value and opening in place. Replaces a strip of Access / Limits /
// Status details / Manage Connection buttons that showed nothing until pressed.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";

/** One setting: its name and current value, with its editor opening under it. */
export function ConnectionSettingRow({
  title,
  value,
  actionLabel,
  children,
}: {
  title: string;
  value: string;
  /** What the closed row's button says ("Show", "Change"…). */
  actionLabel?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const state = useMemo(() => ({ expanded: open }), [open]);
  const verb = open
    ? t("hub.channels.connectionSettings.hide")
    : (actionLabel ?? t("hub.channels.connectionSettings.show"));
  return (
    <View style={settingsStyles.rowBorder}>
      <View style={[settingsStyles.row, styles.row]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{title}</Text>
          <Text style={settingsStyles.rowHint}>{value}</Text>
        </View>
        <Button
          size="xs"
          variant="ghost"
          onPress={toggle}
          accessibilityState={state}
          accessibilityLabel={t("hub.channels.connectionSettings.toggleLabel", {
            verb,
            title,
          })}
        >
          {verb}
        </Button>
      </View>
      {open ? <View style={styles.panel}>{children}</View> : null}
    </View>
  );
}

/**
 * Send a test message through the Connection: pick where it goes, then review
 * the exact message before it is sent.
 */
export function ConnectionTestMessagePanel({
  destinations,
  initialDestination,
  pending,
  send,
  close,
}: {
  destinations: SelectFieldOption<string>[];
  initialDestination: string | null;
  pending: boolean;
  send(conversationId: string): void;
  close(): void;
}) {
  const { t } = useTranslation();
  const [destination, setDestination] = useState<string | null>(initialDestination);
  const selected = destinations.find((option) => option.value === destination);
  const display = useMemo(
    () =>
      selected === undefined
        ? null
        : {
            label: selected.label,
            ...(selected.description ? { description: selected.description } : {}),
          },
    [selected],
  );
  const submit = useCallback(() => {
    if (destination !== null) send(destination);
  }, [destination, send]);
  return (
    <View style={[settingsStyles.row, styles.testPanel]}>
      <SelectField
        label={t("hub.channels.connectionSettings.testTo")}
        value={destination}
        selectedDisplay={display}
        options={destinations}
        onChange={setDestination}
        placeholder={t("hub.channels.connectionSettings.chooseConversation")}
        emptyText={t("hub.channels.connectionSettings.noConversation")}
        searchable={destinations.length > 6}
        title={t("hub.channels.connectionSettings.testTo")}
        disabled={pending}
      />
      <View style={styles.actions}>
        <Button size="sm" disabled={pending || destination === null} onPress={submit}>
          {t("hub.channels.connectionSettings.previewAndSend")}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onPress={close}>
          {t("hub.channels.card.cancel")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { alignItems: "center", flexDirection: "row", gap: theme.spacing[3] },
  panel: { paddingBottom: theme.spacing[2] },
  testPanel: { flexDirection: "column", alignItems: "stretch", gap: theme.spacing[3] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
