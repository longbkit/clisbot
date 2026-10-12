import { useEffect, useMemo, useState } from "react";
import { HubConnectionSchema } from "@clisbot/protocol/device-pairing-offer";
import type { z } from "zod";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { isStoppedHostHub } from "./unavailable-hub";
import { isLoopbackOrigin } from "./loopback-origin";

export interface DetectedHub {
  origin: string;
  serverId: string;
  hostLabel: string;
  stopped: boolean;
  local: boolean;
  /** Last enrolled identity remains useful while the Hub itself is down. */
  hubId?: string;
  connection?: z.infer<typeof HubConnectionSchema>;
}
export type HostHubCheck =
  | { kind: "checking" | "failed" | "unsupported" }
  | { kind: "ready"; hub: DetectedHub | null };

async function checkHost(host: HostProfile): Promise<HostHubCheck> {
  const client = getHostRuntimeStore().getSnapshot(host.serverId)?.client;
  if (!client) throw new Error("Host disconnected");
  if (!client.getLastServerInfoMessage()?.features?.hubDiscovery) return { kind: "unsupported" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { status } = await Promise.race([
      client.getHubStatus(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Host discovery timed out")), 5_000);
      }),
    ]);
    if (!status.hubOrigin) return { kind: "ready", hub: null };
    return {
      kind: "ready",
      hub: {
        origin: status.hubOrigin,
        serverId: host.serverId,
        hostLabel: host.label,
        stopped: isStoppedHostHub(status),
        local: isLoopbackOrigin(status.hubOrigin),
        hubId:
          status.hubConnection?.hubId ?? host.management?.hubOrigin.match(/^hub:\/\/(.+)$/)?.[1],
        ...(status.hubConnection
          ? { connection: HubConnectionSchema.parse(status.hubConnection) }
          : {}),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** A failed or offline Host is unknown, never evidence that it has no Hub. Each Host
 * settles independently so a stalled Host cannot hide the others' next steps. */
export function useHubHostDiscovery(hosts: HostProfile[], attempt: number) {
  const [result, setResult] = useState<{
    hosts: HostProfile[];
    attempt: number;
    checks: Record<string, HostHubCheck>;
  }>({ hosts: [], attempt: -1, checks: {} });
  useEffect(() => {
    let alive = true;
    setResult({ hosts, attempt, checks: {} });
    for (const host of hosts) {
      void checkHost(host)
        .catch((): HostHubCheck => ({ kind: "failed" }))
        .then((check) => {
          if (alive)
            setResult((current) => ({
              ...current,
              checks: { ...current.checks, [host.serverId]: check },
            }));
          return undefined;
        });
    }
    return () => {
      alive = false;
    };
  }, [hosts, attempt]);
  return useMemo(() => {
    const checks = result.hosts === hosts && result.attempt === attempt ? result.checks : {};
    const detected = Object.values(checks).flatMap((check) =>
      check.kind === "ready" && check.hub ? [check.hub] : [],
    );
    let state: "loading" | "error" | "ready" = "ready";
    if (Object.values(checks).some((check) => check.kind === "failed")) state = "error";
    if (hosts.some((host) => !checks[host.serverId])) state = "loading";
    return { checks, detected, state } as const;
  }, [hosts, attempt, result]);
}
