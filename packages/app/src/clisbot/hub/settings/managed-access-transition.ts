import { useCallback, useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import type { ManagedAccessMode } from "@getpaseo/protocol/managed-access";
import { daemonConfigQueryKey } from "@/data/daemon-config";
import { getHostRuntimeStore, useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { HubDaemonsSchema } from "../contracts";
import { hubResourceQueryKey } from "../query-keys";

const HUB_MODE_ATTEMPTS = 10;
const HUB_MODE_RETRY_MS = 1_000;
const RECONNECT_TIMEOUT_MS = 30_000;

export type ManagedAccessTransition =
  | { status: "idle" }
  | { status: "switching"; target: ManagedAccessMode }
  | { status: "done"; mode: ManagedAccessMode }
  | { status: "failed"; message: string };

interface HubDaemonScope {
  origin: string | null;
  organizationId: string | null;
  accountId: string | null;
  daemonId: string;
}

/**
 * Switching managed access closes this device's own session when it turns on: the daemon now wants
 * a Hub ticket. That close is the expected outcome, not a failure. The switch then waits for Hub to
 * report the new mode, which is what makes this app present a ticket, reconnects, and finishes once
 * the Host is back online in the new mode.
 */
export function useManagedAccessTransition(input: {
  serverId: string;
  scope: HubDaemonScope;
  daemonMode: ManagedAccessMode | undefined;
  applyMode: (mode: ManagedAccessMode) => Promise<void>;
}) {
  const { serverId, scope, daemonMode, applyMode } = input;
  const queryClient = useQueryClient();
  const connectionStatus = useHostRuntimeConnectionStatus(serverId);
  const [transition, setTransition] = useState<ManagedAccessTransition>({ status: "idle" });

  const switchMode = useCallback(
    async (target: ManagedAccessMode) => {
      setTransition({ status: "switching", target });
      try {
        await applyMode(target);
      } catch (error) {
        if (!(target === "external" && closedForManagedAccess(error))) {
          setTransition({ status: "failed", message: describe(error) });
          return;
        }
        // The daemon applied the mode before closing the session that asked for it.
        queryClient.setQueryData<MutableDaemonConfig>(daemonConfigQueryKey(serverId), (config) =>
          config ? { ...config, managedAccess: { ...config.managedAccess, mode: target } } : config,
        );
      }
      await waitForHubMode(queryClient, scope, target);
      await getHostRuntimeStore().restartHostConnection(serverId);
    },
    [applyMode, queryClient, scope, serverId],
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
        message:
          "This Host did not reconnect. Use Reconnect in Account → Hosts, or check its daemon.",
      });
    }, RECONNECT_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [connectionStatus, daemonMode, target]);

  return { transition, switchMode };
}

function closedForManagedAccess(error: unknown): boolean {
  return /managed access/i.test(describe(error));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to update managed access.";
}

async function waitForHubMode(
  queryClient: QueryClient,
  scope: HubDaemonScope,
  mode: ManagedAccessMode,
): Promise<void> {
  const queryKey = hubResourceQueryKey(scope, "daemons");
  for (let attempt = 0; attempt < HUB_MODE_ATTEMPTS; attempt += 1) {
    await queryClient.refetchQueries({ queryKey });
    const data = queryClient.getQueryData<z.infer<typeof HubDaemonsSchema>>(queryKey);
    const daemon = data?.daemons.find(({ id }) => id === scope.daemonId);
    if (daemon?.managedAccessMode === mode) return;
    await new Promise((resolve) => setTimeout(resolve, HUB_MODE_RETRY_MS));
  }
}
