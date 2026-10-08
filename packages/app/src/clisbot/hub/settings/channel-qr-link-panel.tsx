import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Image, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useIsCompactFormFactor } from "@/constants/layout";
import { i18n } from "@/i18n/i18next";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { channelApiProblem } from "../channel-api";
import {
  channelQrActionLabel,
  channelQrFailure,
  channelQrLoginGuide,
  openChannelQrLinking,
  shouldPollChannelQr,
  type ChannelQrAction,
  type ChannelQrLoginGuide,
  type ChannelQrModel,
  type ChannelQrPhase,
  type ChannelQrPollResult,
  type ChannelQrStartResult,
  type ChannelQrState,
} from "../channel-qr-linking";

const POLL_INTERVAL_MS = 2_000;

export interface ChannelQrVerbs {
  start(input: { relink: boolean }): Promise<ChannelQrStartResult>;
  poll(): Promise<ChannelQrPollResult>;
  cancel(): Promise<{ cancelled: boolean; message: string }>;
  logout(): Promise<{ cleared: boolean; message: string }>;
  /** Called once the login reaches `linked`, so the account's status refreshes. */
  linked?(): void;
}

/**
 * QR login for an `auth: "qr"` account, as one row: what to do, and the one
 * button that does it. While a code waits for a scan the row holds the steps on
 * the left and the code on the right, as the phone apps' own web logins do.
 *
 * The panel starts in `idle` and finds out what the Hub can do from the first
 * verb: a 404 settles it as `unavailable`, so "not available on this Hub" is
 * the Hub's own answer rather than a build-time assumption.
 *
 * `framed` puts the row in its own Login section (a channel's detail page);
 * without it the row sits inside the Connection card it belongs to.
 * `autoStart` shows the code at once, for a Connection that was just added.
 */
export function ChannelQrLinkPanel({
  channel,
  available,
  verbs,
  framed = false,
  autoStart = false,
  onPhase,
}: {
  channel: string;
  available: boolean;
  verbs: ChannelQrVerbs;
  framed?: boolean;
  autoStart?: boolean;
  /** Told every phase the login reaches (the login step's Continue and its cleanup). */
  onPhase?: (phase: ChannelQrPhase) => void;
}) {
  const { t } = useTranslation();
  const [model] = useState(() => openChannelQrLinking({ available }));
  useEffect(() => () => model.close(), [model]);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  useChannelQrPolling(model, state.phase, state.polling, verbs);
  const { linked } = verbs;
  useEffect(() => {
    if (state.phase === "linked") linked?.();
  }, [linked, state.phase]);
  useEffect(() => {
    onPhase?.(state.phase);
  }, [onPhase, state.phase]);
  const run = useQrAction(model, verbs);
  useAutoStart(autoStart && available, model, verbs);
  const row = (
    <QrLoginRow state={state} guide={channelQrLoginGuide(channel)} run={run} bordered={!framed} />
  );
  if (!framed) return row;
  return (
    <SettingsSection title={t("hub.channels.qrPanel.login")}>
      <View style={settingsStyles.card}>{row}</View>
    </SettingsSection>
  );
}

function QrLoginRow({
  state,
  guide,
  run,
  bordered,
}: {
  state: ChannelQrState;
  guide: ChannelQrLoginGuide;
  run(action: ChannelQrAction): void;
  bordered: boolean;
}) {
  const compact = useIsCompactFormFactor();
  const scanning = state.phase === "pending" && state.qrDataUrl !== null;
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null, styles.row]}>
      <View style={styles.body}>
        <Text style={settingsStyles.rowTitle}>{qrLoginTitle(state, guide)}</Text>
        {scanning ? <ScanSteps steps={guide.steps} /> : null}
        {/* On a phone the code sits between the steps and what to do next. */}
        {scanning && compact ? <QrCodeFrame uri={state.qrDataUrl!} /> : null}
        <QrLoginStatus state={state} guide={guide} />
        <QrLoginActions state={state} run={run} />
      </View>
      {scanning && !compact ? <QrCodeFrame uri={state.qrDataUrl!} /> : null}
    </View>
  );
}

function qrLoginTitle(state: ChannelQrState, guide: ChannelQrLoginGuide): string {
  if (state.phase === "pending") return i18n.t("hub.channels.qrPanel.scanWith", { app: guide.app });
  if (state.phase === "linked" && state.user !== null) {
    return i18n.t("hub.channels.qrPanel.loggedInAs", {
      name: state.user.displayName ?? state.user.userId,
    });
  }
  if (state.phase === "linked")
    return i18n.t("hub.channels.qrPanel.loggedInTo", { app: guide.app });
  return i18n.t("hub.channels.qrPanel.logInTo", { app: guide.app });
}

/** The one line under the title: what happens next, a countdown, or what failed. */
function QrLoginStatus({ state, guide }: { state: ChannelQrState; guide: ChannelQrLoginGuide }) {
  const { t } = useTranslation();
  if (state.phase === "starting") {
    return (
      <View style={styles.inline}>
        <MutedSpinner uniProps={mutedSpinnerColor} />
        <Text style={settingsStyles.rowHint}>{t("hub.channels.qrPanel.preparing")}</Text>
      </View>
    );
  }
  if (state.phase === "failed") {
    return (
      <Text style={settingsStyles.rowError}>
        {state.message ?? t("hub.channels.qrPanel.loginFailed")}
      </Text>
    );
  }
  const hint = qrLoginHint(state, guide);
  return hint === null ? null : <Text style={settingsStyles.rowHint}>{hint}</Text>;
}

function qrLoginHint(state: ChannelQrState, guide: ChannelQrLoginGuide): string | null {
  switch (state.phase) {
    case "idle":
      return i18n.t("hub.channels.qrPanel.idleHint", { app: guide.app });
    case "pending":
      return state.remainingMs === null
        ? null
        : i18n.t("hub.channels.qrPanel.expiresIn", {
            seconds: Math.ceil(state.remainingMs / 1_000),
          });
    case "expired":
      return i18n.t("hub.channels.qrPanel.expiredHint");
    case "linked":
      return i18n.t("hub.channels.qrPanel.linkedHint");
    case "unavailable":
      return state.message ?? i18n.t("hub.channels.qrPanel.unavailableHint");
    default:
      return null;
  }
}

function QrLoginActions({
  state,
  run,
}: {
  state: ChannelQrState;
  run(action: ChannelQrAction): void;
}) {
  const { t } = useTranslation();
  if (state.actions.length === 0) return null;
  return (
    <View style={styles.actions}>
      {state.actions.map((action) => (
        <QrActionButton
          key={action}
          action={action}
          label={
            action === "start" && state.phase !== "idle"
              ? t("hub.channels.qrPanel.tryAgain")
              : channelQrActionLabel(action)
          }
          disabled={state.busy}
          run={run}
        />
      ))}
    </View>
  );
}

function ScanSteps({ steps }: { steps: readonly string[] }) {
  return (
    <View style={styles.steps}>
      {steps.map((step, index) => (
        <Text key={step} style={styles.step}>{`${String(index + 1)}. ${step}`}</Text>
      ))}
    </View>
  );
}

/** A QR code needs a light quiet zone around it to scan, whatever the theme. */
function QrCodeFrame({ uri }: { uri: string }) {
  const { t } = useTranslation();
  const source = useMemo(() => ({ uri }), [uri]);
  return (
    <View style={styles.codeFrame}>
      <Image
        accessibilityLabel={t("hub.channels.qrPanel.codeLabel")}
        source={source}
        style={styles.code}
      />
    </View>
  );
}

function QrActionButton({
  action,
  label,
  disabled,
  run,
}: {
  action: ChannelQrAction;
  label: string;
  disabled: boolean;
  run(action: ChannelQrAction): void;
}) {
  const press = useCallback(() => run(action), [action, run]);
  return (
    <Button
      size="sm"
      variant={action === "start" ? "secondary" : "outline"}
      disabled={disabled}
      onPress={press}
    >
      {label}
    </Button>
  );
}

/** Tries a just-added account this many times: the Hub starts it in the background. */
const AUTO_START_ATTEMPTS = 4;
const AUTO_START_RETRY_MS = 2_000;

/** The account is not running yet (a Connection added a moment ago), as opposed to a real refusal. */
function accountNotReady(problem: { status: number; code: string }): boolean {
  return (
    problem.status === 503 ||
    (problem.status === 404 && problem.code === "channel_account_unavailable")
  );
}

/**
 * Starts the login once, on mount, when the caller asked for the code at once.
 * The Hub starts a just-added account in the background, so a start that finds
 * it not running yet is tried again a few times while the row keeps saying
 * "Preparing a QR code"; any other failure, or the last attempt's, is shown with
 * Try again, which is the operator's own retry from then on.
 */
function useAutoStart(enabled: boolean, model: ChannelQrModel, verbs: ChannelQrVerbs): void {
  const started = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Only the retry is dropped, and only on unmount: a closed model ignores a late answer.
  useEffect(() => () => clearTimeout(retry.current), []);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    const attempt = (count: number) => {
      model.begin("start");
      verbs.start({ relink: false }).then(
        (result) => model.applyStart(result, Date.now()),
        (error: unknown) => {
          const problem = channelApiProblem(error);
          if (count >= AUTO_START_ATTEMPTS || !accountNotReady(problem)) {
            model.fail(channelQrFailure(problem));
            return;
          }
          retry.current = setTimeout(() => attempt(count + 1), AUTO_START_RETRY_MS);
        },
      );
    };
    attempt(1);
  }, [enabled, model, verbs]);
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

/** Ending a working login means scanning again: asked before it happens. */
function confirmEnding(
  action: ChannelQrAction,
): { title: string; message: string; label: string } | undefined {
  if (action === "logout") {
    return {
      title: i18n.t("hub.channels.qrPanel.logoutTitle"),
      message: i18n.t("hub.channels.qrPanel.logoutMessage"),
      label: i18n.t("hub.channels.qr.action.logout"),
    };
  }
  if (action === "relink") {
    return {
      title: i18n.t("hub.channels.qrPanel.relinkTitle"),
      message: i18n.t("hub.channels.qrPanel.relinkMessage"),
      label: i18n.t("hub.channels.qrPanel.continue"),
    };
  }
  return undefined;
}

function useQrAction(
  model: ChannelQrModel,
  verbs: ChannelQrVerbs,
): (action: ChannelQrAction) => void {
  return useCallback(
    (action: ChannelQrAction) => {
      const ending = confirmEnding(action);
      const run = () => runQrAction(model, verbs, action);
      if (ending === undefined) {
        run();
        return;
      }
      void confirmDialog({
        title: ending.title,
        message: ending.message,
        confirmLabel: ending.label,
        destructive: true,
      }).then((confirmed) => {
        if (confirmed) run();
        return undefined;
      });
    },
    [model, verbs],
  );
}

function runQrAction(model: ChannelQrModel, verbs: ChannelQrVerbs, action: ChannelQrAction): void {
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
}

const MutedSpinner = withUnistyles(LoadingSpinner);
const mutedSpinnerColor = (theme: import("@/styles/theme").Theme) => ({
  color: theme.colors.foregroundMuted,
});

const styles = StyleSheet.create((theme) => ({
  row: {
    alignItems: "flex-start",
    gap: theme.spacing[6],
  },
  body: {
    flex: 1,
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  steps: {
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
  },
  step: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[3],
  },
  codeFrame: {
    alignSelf: "center",
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.palette.white,
  },
  code: {
    width: 192,
    height: 192,
  },
}));
