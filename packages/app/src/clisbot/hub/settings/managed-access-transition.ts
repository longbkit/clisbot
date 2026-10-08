import { useCallback, useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { MutableDaemonConfig } from "@clisbot/protocol/messages";
import type { ManagedAccessMode } from "@clisbot/protocol/managed-access";
import { daemonConfigQueryKey } from "@/data/daemon-config";
import { getHostRuntimeStore, useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { i18n } from "@/i18n/i18next";
import type { HubDaemonsSchema } from "../contracts";
import { hubResourceQueryKey } from "../query-keys";

const HUB_MODE_ATTEMPTS = 10;
const HUB_MODE_RETRY_MS = 1_000;
const RECONNECT_TIMEOUT_MS = 30_000;

export type ManagedAccessTransition =
  | { status: "idle" }
  | { status: "switching"; target: ManagedAccessMode }
  | { status: "pairing-required" }
  | { status: "done"; mode: ManagedAccessMode }
  | { status: "failed"; message: string; mode?: ManagedAccessMode };

interface HubDaemonScope {
  origin: string | null;
  organizationId: string | null;
  accountId: string | null;
  daemonId: string;
}

/**
 * Policy changes can close this session before its response arrives. Confirm the new mode through
 * Hub before reconnecting. Protected off mode needs independent daemon authority; a ticket-only
 * device receives pairing guidance instead of an implicit credential upgrade.
 */
export function useManagedAccessTransition(input: {
  serverId: string;
  scope: HubDaemonScope;
  daemonMode: ManagedAccessMode | undefined;
  devicePairing?: boolean;
  hasIndependentCredential?: () => Promise<boolean>;
  applyMode: (mode: ManagedAccessMode) => Promise<void>;
}) {
  const { serverId, scope, daemonMode, applyMode, devicePairing, hasIndependentCredential } = input;
  const queryClient = useQueryClient();
  const connectionStatus = useHostRuntimeConnectionStatus(serverId);
  const [transition, setTransition] = useState<ManagedAccessTransition>({
    status: "idle",
  });

  const switchMode = useCallback(
    async (target: ManagedAccessMode) => {
      setTransition({ status: "switching", target });
      let sessionClosed = false;
      try {
        await applyMode(target);
      } catch (error) {
        if (
          !(
            (target === "external" && closedForManagedAccess(error)) ||
            (target === "off" && devicePairing && closedForDeviceCredential(error))
          )
        ) {
          setTransition({ status: "failed", message: describe(error) });
          return;
        }
        sessionClosed = true;
      }
      const reported = await waitForHubMode(queryClient, scope, target);
      if (devicePairing && sessionClosed && !reported) {
        setTransition({
          status: "failed",
          message: i18n.t("hub.settings.managedAccessTransition.unconfirmed"),
        });
        return;
      }
      // A policy change can close the session before its config response arrives.
      queryClient.setQueryData<MutableDaemonConfig>(daemonConfigQueryKey(serverId), (config) =>
        config
          ? {
              ...config,
              managedAccess: { ...config.managedAccess, mode: target },
            }
          : config,
      );
      if (target === "off" && devicePairing && hasIndependentCredential) {
        const credentialAvailable = await hasIndependentCredential().catch(() => false);
        if (!credentialAvailable) {
          setTransition({ status: "pairing-required" });
          // Drop the old ticket session. Reconnect never issues a daemon credential.
          await getHostRuntimeStore()
            .restartHostConnection(serverId)
            .catch(() => undefined);
          return;
        }
      }
      try {
        await getHostRuntimeStore().restartHostConnection(serverId);
      } catch (error) {
        setTransition({
          status: "failed",
          message: describe(error),
          mode: target,
        });
      }
    },
    [applyMode, queryClient, scope, serverId, devicePairing, hasIndependentCredential],
  );

  const target = transition.status === "switching" ? transition.target : null;
  useEffect(() => {
    if (target === null) return;
    if (connectionStatus === "online" && daemonMode === target) {
      setTransition({ status: "done", mode: target });
      return;
    }
    const timeout = setTimeout(() => {
      setTransition({
        status: "failed",
        message: i18n.t("hub.settings.managedAccessTransition.noReconnect"),
        ...(devicePairing && target === "off" ? { mode: target } : {}),
      });
    }, RECONNECT_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [connectionStatus, daemonMode, target, devicePairing]);

  const finishPairing = useCallback(() => setTransition({ status: "done", mode: "off" }), []);
  return { transition, switchMode, finishPairing };
}

// Matching reads the daemon's English text, including this fallback for a non-Error rejection.
const UPDATE_FAILED = "Unable to update managed access.";

function closedForManagedAccess(error: unknown): boolean {
  return /managed access/i.test(error instanceof Error ? error.message : UPDATE_FAILED);
}

function closedForDeviceCredential(error: unknown): boolean {
  return /daemon device credentials are now required/i.test(
    error instanceof Error ? error.message : UPDATE_FAILED,
  );
}

function describe(error: unknown): string {
  return error instanceof Error
    ? error.message
    : i18n.t("hub.settings.managedAccessTransition.updateFailed");
}

async function waitForHubMode(
  queryClient: QueryClient,
  scope: HubDaemonScope,
  mode: ManagedAccessMode,
): Promise<boolean> {
  const queryKey = hubResourceQueryKey(scope, "daemons");
  for (let attempt = 0; attempt < HUB_MODE_ATTEMPTS; attempt += 1) {
    await queryClient.refetchQueries({ queryKey });
    const data = queryClient.getQueryData<z.infer<typeof HubDaemonsSchema>>(queryKey);
    const daemon = data?.daemons.find(({ id }) => id === scope.daemonId);
    if (daemon?.managedAccessMode === mode) return true;
    await new Promise((resolve) => setTimeout(resolve, HUB_MODE_RETRY_MS));
  }
  return false;
}
