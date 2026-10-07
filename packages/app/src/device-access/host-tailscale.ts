import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { HostTailscale } from "@clisbot/protocol/host-tailscale";
import { useFetchQuery } from "@/data/query";
import { daemonPairingOfferQueryKey } from "@/data/daemon-pairing";
import { useHostRuntimeClient, useHostRuntimeSnapshot } from "@/runtime/host-runtime";

export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";

export function hostTailscaleQueryKey(serverId: string) {
  return ["host-tailscale", serverId] as const;
}

/** Tailscale on one Host, read from its daemon, and the owner's Set up action.
 * `supported` is false on Hosts or sessions that do not offer the capability. */
export function useHostTailscale(serverId: string | undefined) {
  const client = useHostRuntimeClient(serverId ?? "");
  const snapshot = useHostRuntimeSnapshot(serverId ?? "");
  const queryClient = useQueryClient();
  const supported =
    Boolean(serverId) && client?.getLastServerInfoMessage()?.features?.hostTailscale === true;
  const query = useFetchQuery({
    queryKey: hostTailscaleQueryKey(serverId ?? ""),
    queryFn: () => requireClient(client).getHostTailscale(),
    enabled: supported && snapshot?.connectionStatus === "online",
    dataShape: "value",
    staleTimeMs: 30_000,
    retry: false,
  });
  const setUp = useMutation({
    mutationFn: () => requireClient(client).setUpHostTailscale(),
    onSuccess: (tailscale) => {
      queryClient.setQueryData(hostTailscaleQueryKey(serverId ?? ""), tailscale);
      // The pairing link now carries the Tailscale route.
      if (serverId)
        void queryClient.invalidateQueries({ queryKey: daemonPairingOfferQueryKey(serverId) });
    },
  });
  return { supported, query, setUp };
}

function requireClient<T>(client: T | null | undefined): T {
  if (!client) throw new Error("Host disconnected");
  return client;
}

export type TailscaleRowAction = "setUp" | "getTailscale" | "enableOnTailnet" | "retry";
export interface TailscaleRowModel {
  status:
    | "checking"
    | "settingUp"
    | "on"
    | "notSetUp"
    | "missing"
    | "signedOut"
    | "stopped"
    | "httpsOff"
    | "unavailable";
  tone: "success" | "warning" | "muted";
  hint?: string;
  actions: TailscaleRowAction[];
}

/** One status and the one way forward for each Tailscale state. */
export function tailscaleRowModel(input: {
  tailscale: HostTailscale | undefined;
  /** Whether an HTTPS origin is already mapped, decided by the caller. */
  mapped?: boolean;
  settingUp?: boolean;
  /** The status read failed; the caller shows the error beside the row. */
  failed?: boolean;
}): TailscaleRowModel {
  const { tailscale } = input;
  if (input.settingUp) return { status: "settingUp", tone: "muted", actions: [] };
  if (!tailscale && input.failed)
    return { status: "unavailable", tone: "warning", actions: ["retry"] };
  if (!tailscale) return { status: "checking", tone: "muted", actions: [] };
  const hint = tailscale.guidance;
  switch (tailscale.state) {
    case "missing":
      return { status: "missing", tone: "muted", actions: ["getTailscale"] };
    case "login-required":
      return { status: "signedOut", tone: "warning", hint, actions: ["retry"] };
    case "stopped":
      return { status: "stopped", tone: "warning", hint, actions: ["retry"] };
    case "unavailable":
      return tailscale.actionUrl
        ? { status: "httpsOff", tone: "warning", hint, actions: ["enableOnTailnet", "retry"] }
        : { status: "unavailable", tone: "warning", hint, actions: ["retry"] };
    case "ready":
      return (input.mapped ?? Boolean(tailscale.origin))
        ? { status: "on", tone: "success", hint: tailscale.origin, actions: [] }
        : { status: "notSetUp", tone: "muted", actions: ["setUp"] };
  }
}
