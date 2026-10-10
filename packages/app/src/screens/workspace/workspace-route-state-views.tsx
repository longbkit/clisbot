import { useCallback } from "react";
import { Text, View } from "react-native";
import { ArrowLeftToLine, RotateCw, Settings } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatConnectionStatus } from "@/utils/daemons";
import type { WorkspaceRouteState } from "@/screens/workspace/workspace-route-state";
import type { Theme } from "@/styles/theme";
import { useHostWaitTimeout } from "@/hosts/use-host-wait-timeout";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { useHostInventory } from "@/clisbot/hub/host-inventory";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface WorkspaceRouteStateActions {
  onRetryHost: () => void;
  onManageHost: () => void;
  onDismissMissingWorkspace: () => void;
  onRecoverWorkspace: () => void;
  onRetryRecoveryInspection: () => void;
}

export function renderWorkspaceRouteGate(input: {
  state: WorkspaceRouteState;
  actions: WorkspaceRouteStateActions;
}): React.ReactNode {
  switch (input.state.kind) {
    case "loading":
      return (
        <WorkspaceConnecting
          hostName={input.state.hostName}
          onRetry={input.actions.onRetryHost}
          onManageHost={input.actions.onManageHost}
        />
      );
    case "missing":
      return (
        <WorkspaceEmptyState
          titleKey="workspace.route.recovery.unavailableTitle"
          hostName={input.state.hostName}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "archived":
      return (
        <ArchivedWorkspaceRecovery
          state={input.state}
          onRecover={input.actions.onRecoverWorkspace}
        />
      );
    case "needsHostUpgrade":
      return (
        <WorkspaceEmptyState
          titleKey="workspace.route.needsHostUpgrade"
          hostName={input.state.hostName}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "unreachable":
    case "reconnecting":
      return (
        <WorkspaceUnreachable
          state={input.state}
          onRetry={input.actions.onRetryHost}
          onManageHost={input.actions.onManageHost}
        />
      );
    case "recoveryUnavailable":
      return (
        <WorkspaceEmptyState
          titleKey="workspace.route.recovery.unavailableTitle"
          description={input.state.message}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "recoveryInspectionFailed":
      return (
        <WorkspaceRecoveryInspectionFailed
          state={input.state}
          onRetry={input.actions.onRetryRecoveryInspection}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "ready":
      return null;
  }
}

function getWorkspaceHostStateTitle(
  state: Extract<WorkspaceRouteState, { kind: "unreachable" | "reconnecting" }>,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (state.connectionStatus === "connecting" || state.connectionStatus === "idle") {
    return t("workspace.route.connecting");
  }
  if (state.connectionStatus === "offline") {
    return t("workspace.route.hostOffline", { hostName: state.hostName });
  }
  return t("workspace.route.cannotReachHost", { hostName: state.hostName });
}

function WorkspaceConnecting({
  hostName,
  onRetry,
  onManageHost,
}: {
  hostName: string;
  onRetry: () => void;
  onManageHost: () => void;
}) {
  const { t } = useTranslation();
  const { timedOut, reset } = useHostWaitTimeout(true, useHostRouteServerId());
  const retry = useCallback(() => {
    reset();
    onRetry();
  }, [reset, onRetry]);

  return (
    <View style={styles.emptyState}>
      {!timedOut ? (
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      ) : null}
      <View style={styles.textStack}>
        <Text style={styles.title}>
          {t(timedOut ? "workspace.route.loadTimedOut" : "workspace.route.loading")}
        </Text>
        <Text style={styles.description}>{hostName}</Text>
      </View>
      {timedOut ? (
        <View style={styles.actions}>
          <Button onPress={retry}>{t("common.actions.retry")}</Button>
          <Button variant="outline" onPress={onManageHost}>
            {t("workspace.route.manageHost")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function ArchivedWorkspaceRecovery({
  state,
  onRecover,
}: {
  state: Extract<WorkspaceRouteState, { kind: "archived" }>;
  onRecover: () => void;
}) {
  const { t } = useTranslation();
  const { recovery } = state;
  const isRestoring = recovery.phase === "restoring";
  let actionLabel = t("workspace.route.recovery.unarchiveAction");
  if (recovery.recovery.action === "restore") {
    actionLabel = t("workspace.route.recovery.restoreAction");
  }
  if (recovery.phase === "failed") {
    actionLabel = t("common.actions.retry");
  }
  let description: string;
  if (recovery.recovery.action === "restore" && recovery.recovery.branch) {
    description = t("workspace.route.recovery.restoreDescription", {
      workspaceName: recovery.recovery.workspaceName,
      branch: recovery.recovery.branch,
    });
  } else if (recovery.recovery.action === "restore") {
    description = t("workspace.route.recovery.restoreWithoutBranchDescription", {
      workspaceName: recovery.recovery.workspaceName,
    });
  } else {
    description = t("workspace.route.recovery.unarchiveDescription", {
      workspaceName: recovery.recovery.workspaceName,
    });
  }

  return (
    <View style={styles.emptyState}>
      {isRestoring ? (
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      ) : null}
      <View style={styles.textStack}>
        <Text style={styles.title}>
          {isRestoring
            ? t("workspace.route.recovery.restoringTitle")
            : t("workspace.route.recovery.archivedTitle")}
        </Text>
        <Text style={styles.description}>{description}</Text>
        {recovery.error ? (
          <Text style={styles.error} testID="workspace-recovery-error">
            {recovery.error}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button
          size="sm"
          variant="default"
          leftIcon={isRestoring ? undefined : RotateCw}
          onPress={onRecover}
          disabled={isRestoring}
          testID="workspace-recovery-action"
        >
          {isRestoring ? t("workspace.route.recovery.restoringAction") : actionLabel}
        </Button>
      </View>
    </View>
  );
}

function WorkspaceRecoveryInspectionFailed({
  state,
  onRetry,
  onDismiss,
}: {
  state: Extract<WorkspaceRouteState, { kind: "recoveryInspectionFailed" }>;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyState}>
      <View style={styles.textStack}>
        <Text style={styles.title}>{t("workspace.route.recovery.checkFailedTitle")}</Text>
        <Text style={styles.error}>{state.error}</Text>
      </View>
      <View style={styles.actions}>
        <Button size="sm" variant="default" leftIcon={RotateCw} onPress={onRetry}>
          {t("common.actions.retry")}
        </Button>
        <Button size="sm" variant="outline" leftIcon={ArrowLeftToLine} onPress={onDismiss}>
          {t("common.actions.back")}
        </Button>
      </View>
    </View>
  );
}

function WorkspaceUnreachable({
  state,
  onRetry,
  onManageHost,
}: {
  state: Extract<WorkspaceRouteState, { kind: "unreachable" | "reconnecting" }>;
  onRetry: () => void;
  onManageHost: () => void;
}) {
  const { t } = useTranslation();
  const serverId = useHostRouteServerId();
  const { hosts, daemons, retry: refreshHosts } = useHostInventory();
  const management = hosts.find((host) => host.serverId === serverId)?.management;
  const hubOffline =
    management &&
    !daemons.error &&
    daemons.data?.daemons.some(
      (daemon) => daemon.id === management.daemonId && daemon.presence === "offline",
    );
  const displayState = hubOffline ? { ...state, connectionStatus: "offline" as const } : state;
  const waiting =
    displayState.connectionStatus === "connecting" || displayState.connectionStatus === "idle";
  const { timedOut, reset } = useHostWaitTimeout(waiting, serverId);
  const canRetry = !waiting || timedOut;
  const retry = useCallback(() => {
    reset();
    refreshHosts();
    onRetry();
  }, [reset, refreshHosts, onRetry]);

  return (
    <View style={styles.emptyState}>
      {waiting && !timedOut ? (
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      ) : null}
      <View style={styles.textStack}>
        <Text style={styles.title}>
          {timedOut
            ? t("workspace.route.connectionTimedOut", { hostName: state.hostName })
            : getWorkspaceHostStateTitle(displayState, t)}
        </Text>
        <Text style={styles.description}>
          {waiting
            ? state.hostName
            : t("workspace.route.hostStatus", {
                status: formatConnectionStatus(displayState.connectionStatus),
              })}
        </Text>
        {state.lastError ? (
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <Text style={styles.error} numberOfLines={3}>
                {state.lastError}
              </Text>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.errorTooltip}>{state.lastError}</Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </View>
      {canRetry ? (
        <View style={styles.actions}>
          <Button size="sm" variant="default" leftIcon={RotateCw} onPress={retry}>
            {t("common.actions.retry")}
          </Button>
          <Button size="sm" variant="outline" leftIcon={Settings} onPress={onManageHost}>
            {t("workspace.route.manageHost")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function WorkspaceEmptyState({
  titleKey,
  hostName,
  description,
  onDismiss,
}: {
  titleKey: "workspace.route.needsHostUpgrade" | "workspace.route.recovery.unavailableTitle";
  hostName?: string;
  description?: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.emptyState}>
      <View style={styles.textStack}>
        <Text style={styles.title}>{t(titleKey)}</Text>
        <Text style={styles.description}>{description ?? hostName}</Text>
      </View>
      <View style={styles.actions}>
        <Button size="sm" variant="default" leftIcon={ArrowLeftToLine} onPress={onDismiss}>
          {t("common.actions.back")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  textStack: {
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 520,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    lineHeight: Math.round(theme.fontSize.base * 1.4),
    textAlign: "center",
  },
  errorTooltip: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.base,
    maxWidth: 420,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
