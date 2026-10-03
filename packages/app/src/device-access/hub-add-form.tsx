import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { HubText as Text } from "./hub-text";
import { HubContextNote, HubStatusBadge } from "./hub-ui";

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
  if (props.intent === "add" || (props.noHubs && props.intent === null))
    return (
      <>
        {props.options}
        {props.intent === "add" ? (
          <View style={styles.actions}>
            <Button variant="outline" disabled={props.busy} onPress={props.cancel}>
              Cancel
            </Button>
          </View>
        ) : null}
      </>
    );
  return props.intent === "start" ? <StartHubForm {...props} /> : <ConnectHubForm {...props} />;
}

function StartHubForm(props: HubAddFormProps) {
  return (
    <View style={[settingsStyles.card, styles.form]}>
      <Text style={styles.title}>Start your own Hub</Text>
      <Text style={styles.hint}>
        Choose a connected Host to run it. Your Host keeps running its agents independently.
      </Text>
      <Field label="Host">{props.hostPicker}</Field>
      <HubStatusBadge label="Personal Hub · No account sign-in required" />
      {props.hasHosts && !props.canStartHub ? (
        <Alert
          variant="info"
          title="This connection cannot start a Hub"
          description="Update the CLI on this Host and pair this device with its independent owner access. Hub account access alone does not allow starting a Hub. The local operator can also run clisbot hub start --personal on that Host, then share its connection link."
        />
      ) : null}
      <DeviceLabelField {...props} />
      <Text style={styles.hint}>
        Tailscale on your Host and phone is preferred for speed. Relay works without Tailscale
        setup.
      </Text>
      {props.error ? (
        <Alert variant="error" title="Hub setup could not finish" description={props.error} />
      ) : null}
      <HubFormActions {...props} starting />
    </View>
  );
}

function ConnectHubForm(props: HubAddFormProps) {
  return (
    <>
      <View style={[settingsStyles.card, styles.form]}>
        <Text style={styles.title}>Connect existing Hub</Text>
        <Text style={styles.hint}>
          Use a Hub already running on another computer or provided by your team. Clisbot checks how
          to connect.
        </Text>
        <Field label="Hub URL" hint="Tailscale HTTPS, public HTTPS or a Hub connection link.">
          <FormTextInput
            initialValue={props.link}
            onChangeText={props.setLink}
            accessibilityLabel="Hub URL or pairing link"
            placeholder="Paste a Hub URL or connection link"
            editable={!props.busy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </Field>
        {props.error ? (
          <Alert variant="error" title="Could not connect to Hub" description={props.error} />
        ) : (
          props.entryNotice
        )}
        <DeviceLabelField {...props} />
        <HubFormActions {...props} starting={false} />
      </View>
      <HubContextNote>
        A Hub with account sign-in and completed owner setup needs no manual pairing. Personal Hubs
        and first-owner setup require an approved pairing link.
      </HubContextNote>
    </>
  );
}

function DeviceLabelField(props: Pick<HubAddFormProps, "label" | "setLabel" | "busy">) {
  return (
    <Field label="This device" hint="Use a name you will recognize in the paired-device list.">
      <FormTextInput
        initialValue={props.label}
        onChangeText={props.setLabel}
        accessibilityLabel="Device label"
        placeholder="This device"
        editable={!props.busy}
      />
    </Field>
  );
}

function HubFormActions(props: HubAddFormProps & { starting: boolean }) {
  const idleLabel = props.starting ? "Start Hub and connect this device" : "Connect Hub";
  const busyLabel = props.starting ? "Starting Hub..." : "Connecting...";
  return (
    <View style={styles.actions}>
      <Button variant="outline" disabled={props.busy} onPress={props.cancel}>
        Cancel
      </Button>
      {!props.starting ? (
        <Button variant="outline" disabled={props.busy} onPress={props.scan}>
          Scan QR code
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
