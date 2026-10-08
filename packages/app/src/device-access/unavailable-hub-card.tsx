import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-api-context";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { HubProfile } from "./hub-profiles";
import { HubNetworkIcon, HubStatusBadge, hubMutedIconProps } from "./hub-ui";
import {
  diagnoseUnavailableHub,
  isHubUnreachable,
  type DetectedHubRef,
  type UnavailableHub,
  type UnavailableHubHost,
} from "./unavailable-hub";

/**
 * The selected Hub's diagnosis when it cannot be reached. Null in every other case, and while
 * Host discovery runs, so the card never guesses from partial facts.
 */
export function useSelectedUnavailableHub(input: {
  account: { signedIn: unknown; loading: boolean; state: unknown; error: string | null };
  profile: HubProfile | undefined;
  hosts: readonly UnavailableHubHost[];
  connectedIds: readonly string[];
  detected: readonly DetectedHubRef[];
  discoveryReady: boolean;
  localServerId: string | null;
}): UnavailableHub | null {
  const { account, profile, hosts, connectedIds, detected, localServerId } = input;
  const unreachable = profile !== undefined && input.discoveryReady && isHubUnreachable(account);
  return useMemo(
    () =>
      unreachable && profile
        ? diagnoseUnavailableHub({
            hubId: profile.hubId,
            ...(profile.origin ? { origin: profile.origin } : {}),
            hosts,
            connectedIds,
            detected,
            localServerId,
          })
        : null,
    [unreachable, profile, hosts, connectedIds, detected, localServerId],
  );
}

/**
 * The selected Hub, when it cannot be reached: where it runs, why it is unavailable, and the
 * one step that helps. Replaces the saved-Hub row only in that state.
 */
export function UnavailableHubCard(props: {
  profile: HubProfile;
  diagnosis: UnavailableHub;
  disabled: boolean;
  startOn(serverId: string): void;
  switchToOther(hub: DetectedHubRef): void;
  retry(): void;
  remove(hubId: string): Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { profile, remove } = props;
  const confirmRemove = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("hub.connection.unavailable.removeTitle", { name: profile.label }),
      message: t("hub.connection.unavailable.removeMessage"),
      confirmLabel: t("hub.connection.unavailable.removeConfirm"),
      destructive: true,
    });
    if (!confirmed) return;
    await remove(profile.hubId).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error)),
    );
  }, [profile.hubId, profile.label, remove, t, toast]);
  return (
    <View style={[settingsStyles.card, styles.card]} testID="unavailable-hub-card">
      <View style={styles.heading}>
        <HubNetworkIcon size={18} uniProps={hubMutedIconProps} />
        <Text style={styles.title}>{profile.label}</Text>
        <HubStatusBadge label={t("hub.connection.status.unavailable")} tone="warning" />
      </View>
      <UnavailableHubText diagnosis={props.diagnosis} />
      <View style={styles.actions}>
        <Button variant="outline" size="sm" disabled={props.disabled} onPress={confirmRemove}>
          {t("hub.connection.unavailable.remove")}
        </Button>
        <UnavailableHubAction {...props} />
      </View>
    </View>
  );
}

function UnavailableHubText({ diagnosis }: { diagnosis: UnavailableHub }) {
  const { t } = useTranslation();
  const lines: string[] = [];
  if (diagnosis.kind === "stopped" || diagnosis.kind === "replaced") {
    const { label, serverId } = diagnosis.host;
    lines.push(t("hub.connection.unavailable.runsOn", { host: label, id: serverId }));
    lines.push(
      diagnosis.kind === "stopped"
        ? t("hub.connection.unavailable.stopped")
        : t("hub.connection.unavailable.replaced", { host: label }),
    );
  } else if (diagnosis.kind === "hostGone") {
    if (diagnosis.ranOn)
      lines.push(
        t("hub.connection.unavailable.ranOn", {
          host: diagnosis.ranOn.label,
          id: diagnosis.ranOn.serverId,
        }),
      );
    lines.push(t("hub.connection.unavailable.hostGone"));
    lines.push(
      diagnosis.startOn
        ? t("hub.connection.unavailable.startNewNote")
        : t("hub.connection.unavailable.hostGoneNoStart"),
    );
  } else {
    lines.push(t("hub.connection.unavailable.unreachable"));
  }
  return (
    <View style={styles.body}>
      {lines.map((line, index) => (
        <Text key={line} style={index === 0 ? styles.where : settingsStyles.rowHint} selectable>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** The one primary step for this state; none when no connected Host can help. */
function UnavailableHubAction(props: {
  diagnosis: UnavailableHub;
  disabled: boolean;
  startOn(serverId: string): void;
  switchToOther(hub: DetectedHubRef): void;
  retry(): void;
}) {
  const { t } = useTranslation();
  const { diagnosis, startOn, switchToOther, retry } = props;
  const run = useCallback(() => {
    if (diagnosis.kind === "stopped") startOn(diagnosis.host.serverId);
    else if (diagnosis.kind === "replaced") switchToOther(diagnosis.other);
    else if (diagnosis.kind === "hostGone" && diagnosis.startOn)
      startOn(diagnosis.startOn.serverId);
    else retry();
  }, [diagnosis, retry, startOn, switchToOther]);
  let label = t("hub.connection.common.retryConnection");
  if (diagnosis.kind === "stopped") label = t("hub.connection.unavailable.startAgain");
  if (diagnosis.kind === "replaced") label = t("hub.connection.unavailable.useOther");
  if (diagnosis.kind === "hostGone") {
    if (!diagnosis.startOn) return null;
    label = t("hub.connection.unavailable.startNew", { host: diagnosis.startOn.label });
  }
  return (
    <Button variant="outline" size="sm" disabled={props.disabled} onPress={run}>
      {label}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { padding: theme.spacing[4], gap: theme.spacing[3] },
  heading: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  title: {
    flex: 1,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    fontSize: theme.fontSize.base,
  },
  body: { gap: theme.spacing[1] },
  where: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
