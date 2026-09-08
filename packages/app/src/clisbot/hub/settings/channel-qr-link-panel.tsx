import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Image, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { channelApiProblem } from "../channel-api";
import {
  CHANNEL_QR_ACTION_LABELS,
  channelQrFailure,
  openChannelQrLinking,
  shouldPollChannelQr,
  type ChannelQrAction,
  type ChannelQrModel,
  type ChannelQrPhase,
  type ChannelQrPollResult,
  type ChannelQrStartResult,
} from "../channel-qr-linking";

const POLL_INTERVAL_MS = 2_000;

export interface ChannelQrVerbs {
  start(input: { relink: boolean }): Promise<ChannelQrStartResult>;
  poll(): Promise<ChannelQrPollResult>;
  cancel(): Promise<{ cancelled: boolean; message: string }>;
  logout(): Promise<{ cleared: boolean; message: string }>;
}

/**
 * QR linking for an `auth: "qr"` account. The panel starts in `idle` and finds
 * out what the Hub can do from the first verb: a 404 settles it as
 * `unavailable`, so the "not available on this Hub" state is the Hub's own
 * answer rather than a build-time assumption.
 */
export function ChannelQrLinkPanel({
  accountId,
  available,
  verbs,
}: {
  accountId: string;
  available: boolean;
  verbs: ChannelQrVerbs;
}) {
  const [model] = useState(() => openChannelQrLinking({ available }));
  useEffect(() => () => model.close(), [model]);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  useChannelQrPolling(model, state.phase, state.polling, verbs);
  const run = useQrAction(model, verbs);
  const code = useMemo(
    () => (state.qrDataUrl === null ? null : { uri: state.qrDataUrl }),
    [state.qrDataUrl],
  );
  return (
    <SettingsSection title="Linked account">
      <View style={[settingsStyles.card, styles.panel]}>
        <View style={styles.header}>
          <Text style={settingsStyles.rowTitle}>{accountId}</Text>
          <StatusBadge label={PHASE_LABELS[state.phase]} variant={PHASE_VARIANTS[state.phase]} />
        </View>
        {state.phase === "unavailable" ? (
          <Alert
            variant="info"
            title="Not available on this Hub"
            description={state.message ?? "This Hub does not serve the QR login operations."}
          />
        ) : null}
        {code === null ? null : (
          <Image accessibilityLabel="Login QR code" source={code} style={styles.code} />
        )}
        {state.qrFilePath === null ? null : (
          <Text style={settingsStyles.rowHint}>{`Also written to ${state.qrFilePath}`}</Text>
        )}
        {state.remainingMs === null ? null : (
          <Text style={settingsStyles.rowHint}>
            {`Expires in ${String(Math.ceil(state.remainingMs / 1_000))}s`}
          </Text>
        )}
        {state.user === null ? null : (
          <Text style={settingsStyles.rowHint}>
            {`Linked as ${state.user.displayName ?? state.user.userId}. Confirm this is the intended account.`}
          </Text>
        )}
        {state.message === null || state.phase === "unavailable" ? null : (
          <Text style={settingsStyles.rowHint}>{state.message}</Text>
        )}
        <View style={styles.actions}>
          {state.actions.map((action) => (
            <QrActionButton key={action} action={action} run={run} />
          ))}
        </View>
      </View>
    </SettingsSection>
  );
}

const PHASE_LABELS: Readonly<Record<ChannelQrPhase, string>> = {
  unavailable: "Unavailable",
  idle: "Not linked",
  starting: "Starting",
  pending: "Waiting for scan",
  linked: "Linked",
  expired: "Expired",
  failed: "Failed",
};

const PHASE_VARIANTS: Readonly<Record<ChannelQrPhase, "success" | "warning" | "error" | "muted">> =
  {
    unavailable: "muted",
    idle: "muted",
    starting: "muted",
    pending: "muted",
    linked: "success",
    expired: "warning",
    failed: "error",
  };

function QrActionButton({
  action,
  run,
}: {
  action: ChannelQrAction;
  run(action: ChannelQrAction): void;
}) {
  const press = useCallback(() => run(action), [action, run]);
  return (
    <Button
      size="sm"
      variant={action === "start" || action === "relink" ? "secondary" : "outline"}
      onPress={press}
    >
      {CHANNEL_QR_ACTION_LABELS[action]}
    </Button>
  );
}

/** The countdown and the poll both run off one timer while a code is on screen. */
function useChannelQrPolling(
  model: ChannelQrModel,
  phase: string,
  polling: boolean,
  verbs: ChannelQrVerbs,
): void {
  useEffect(() => {
    if (phase !== "pending") return;
    const timer = setInterval(() => {
      model.tick(Date.now());
      if (!shouldPollChannelQr(model.getState())) return;
      model.beginPoll();
      verbs.poll().then(
        (result) => model.applyPoll(result),
        (error: unknown) => model.fail(channelQrFailure(channelApiProblem(error))),
      );
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [model, phase, polling, verbs]);
}

function useQrAction(
  model: ChannelQrModel,
  verbs: ChannelQrVerbs,
): (action: ChannelQrAction) => void {
  return useCallback(
    (action: ChannelQrAction) => {
      model.begin(action);
      const failed = (error: unknown) => model.fail(channelQrFailure(channelApiProblem(error)));
      if (action === "start" || action === "relink") {
        void verbs
          .start({ relink: action === "relink" })
          .then((result) => model.applyStart(result, Date.now()), failed);
        return;
      }
      if (action === "cancel") {
        void verbs.cancel().then((result) => model.applyCancel(result), failed);
        return;
      }
      void verbs.logout().then((result) => model.applyLogout(result), failed);
    },
    [model, verbs],
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  code: {
    width: 220,
    height: 220,
    alignSelf: "center",
    borderRadius: theme.borderRadius.lg,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
