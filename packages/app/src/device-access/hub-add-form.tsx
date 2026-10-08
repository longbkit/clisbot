import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { settingsStyles } from "@/styles/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { HubText as Text } from "./hub-text";
import { HubContextNote } from "./hub-ui";

interface HubAddFormProps {
  intent: "add" | "start" | "connect" | null;
  noHubs: boolean;
  compact: boolean;
  options: ReactNode;
  hostPicker: ReactNode;
  hasHosts: boolean;
  label: string;
  setLabel(value: string): void;
  link: string;
  setLink(value: string): void;
  busy: boolean;
  canStartHub: boolean;
  start(): Promise<void>;
  connectEntered(): void;
  scan(): void;
  cancel(): void;
  error: string | null;
  entryNotice: ReactNode;
}

export function HubAddForm(props: HubAddFormProps) {
  const { t } = useTranslation();
  if (props.intent === "add" || (props.noHubs && props.intent === null))
    return (
      <>
        {props.options}
        {props.intent === "add" ? (
          <View style={styles.actions}>
            <Button variant="outline" disabled={props.busy} onPress={props.cancel}>
              {t("hub.connection.common.cancel")}
            </Button>
          </View>
        ) : null}
      </>
    );
  return props.intent === "start" ? <StartHubForm {...props} /> : <ConnectHubForm {...props} />;
}

function StartHubForm(props: HubAddFormProps) {
  const { t } = useTranslation();
  return (
    <View style={[settingsStyles.card, styles.form]}>
      <Text style={styles.title}>{t("hub.connection.add.startTitle")}</Text>
      <Text style={styles.hint}>{t("hub.connection.add.startBody")}</Text>
      <Field label={t("hub.connection.common.host")}>{props.hostPicker}</Field>
      <Text style={styles.hint}>{t("hub.connection.add.personalBadge")}</Text>
      {props.hasHosts && !props.canStartHub ? (
        <Alert
          variant="info"
          title={t("hub.connection.add.cannotStartTitle")}
          description={t("hub.connection.add.cannotStartBody")}
        />
      ) : null}
      <DeviceLabelField {...props} />
      <Text style={styles.hint}>{t("hub.connection.add.preferTailscale")}</Text>
      {props.error ? (
        <Alert
          variant="error"
          title={t("hub.connection.add.setupFailedTitle")}
          description={props.error}
        />
      ) : null}
      <HubFormActions {...props} starting />
    </View>
  );
}

function ConnectHubForm(props: HubAddFormProps) {
  const { t } = useTranslation();
  return (
    <>
      <View style={[settingsStyles.card, styles.form]}>
        <Text style={styles.title}>{t("hub.connection.add.connectExisting")}</Text>
        <Text style={styles.hint}>{t("hub.connection.add.connectBody")}</Text>
        <Field label={t("hub.connection.add.urlLabel")} hint={t("hub.connection.add.urlHint")}>
          <FormTextInput
            initialValue={props.link}
            onChangeText={props.setLink}
            accessibilityLabel={t("hub.connection.add.urlA11y")}
            placeholder={t("hub.connection.add.urlPlaceholder")}
            editable={!props.busy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </Field>
        {props.error ? (
          <Alert
            variant="error"
            title={t("hub.connection.add.connectFailedTitle")}
            description={props.error}
          />
        ) : (
          props.entryNotice
        )}
        <DeviceLabelField {...props} />
        <HubFormActions {...props} starting={false} />
      </View>
      <HubContextNote>{t("hub.connection.add.accountNote")}</HubContextNote>
    </>
  );
}

function DeviceLabelField(props: Pick<HubAddFormProps, "label" | "setLabel" | "busy">) {
  const { t } = useTranslation();
  return (
    <Field label={t("hub.connection.add.thisDevice")} hint={t("hub.connection.add.deviceHint")}>
      <FormTextInput
        initialValue={props.label}
        onChangeText={props.setLabel}
        accessibilityLabel={t("hub.connection.common.deviceLabel")}
        placeholder={t("hub.connection.add.thisDevice")}
        editable={!props.busy}
      />
    </Field>
  );
}

function HubFormActions(props: HubAddFormProps & { starting: boolean }) {
  const { t } = useTranslation();
  const idleLabel = props.starting
    ? t("hub.connection.add.startAndConnect")
    : t("hub.connection.add.connectHub");
  const busyLabel = props.starting
    ? t("hub.connection.add.startingHub")
    : t("hub.connection.common.connecting");
  return (
    <View style={styles.actions}>
      <Button variant="outline" disabled={props.busy} onPress={props.cancel}>
        {t("hub.connection.common.cancel")}
      </Button>
      {!props.starting ? (
        <Button variant="outline" disabled={props.busy} onPress={props.scan}>
          {t("hub.connection.add.scanQr")}
        </Button>
      ) : null}
      <Button
        variant="default"
        disabled={props.busy || (props.starting ? !props.canStartHub : !props.link.trim())}
        loading={props.busy}
        onPress={props.starting ? props.start : props.connectEntered}
        style={props.compact ? styles.fullWidth : undefined}
      >
        {props.busy ? busyLabel : idleLabel}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { padding: theme.spacing[4], gap: theme.spacing[4] },
  title: {
    fontWeight: theme.fontWeight.medium,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    color: theme.colors.foregroundMuted,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  fullWidth: { width: "100%" },
}));
