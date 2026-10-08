import type { HostTailscale } from "@clisbot/protocol/host-tailscale";
import type { HubLocalStartResult } from "@clisbot/protocol/hub-local";
import { getDesktopHost } from "@/desktop/host";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { updateHubProfile, validateHubRoutes, type HubProfile } from "./hub-profiles";
import { PairedHubTransport } from "./hub-transport";

export function isTailscaleOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  try {
    return new URL(origin).hostname.endsWith(".ts.net");
  } catch {
    return false;
  }
}

/** Saves new routes only after they reach the same Hub: the encrypted handshake pins the
 * saved key before a credential is sent. */
export async function saveVerifiedHubRoutes(
  profile: HubProfile,
  routes: { origin?: string; relay?: HubProfile["relay"]; label?: string },
): Promise<void> {
  const candidate = { ...profile, origin: routes.origin, relay: routes.relay };
  validateHubRoutes(candidate);
  const transport = new PairedHubTransport(candidate);
  try {
    const response = await transport.identity();
    if (!response.ok || (await response.json()).hubId !== profile.hubId)
      throw new Error(i18n.t("hub.connection.errors.endpointMismatch"));
    await updateHubProfile(profile.hubId, {
      ...(routes.label !== undefined ? { label: routes.label } : {}),
      origin: routes.origin ?? null,
      relay: routes.relay ?? null,
    });
  } finally {
    transport.close();
  }
}

/** Whether this device may start (or restart) a Hub on that Host. */
export function canStartHubOnHost(serverId: string, localServerId: string | null): boolean {
  if (getDesktopHost()?.invoke && serverId === localServerId) return true;
  const client = getHostRuntimeStore().getSnapshot(serverId)?.client;
  return client?.getLastServerInfoMessage()?.features?.localHubStart === true;
}

/** Starts a personal Hub on a Host, or re-runs it with a new transport. Only the Hub
 * restarts; the daemon keeps running. */
export async function startHubOnHost(input: {
  serverId: string;
  localServerId: string | null;
  label?: string;
  transport?: "tailscale" | "relay";
}): Promise<Partial<HubLocalStartResult>> {
  const desktop = getDesktopHost();
  const client = getHostRuntimeStore().getSnapshot(input.serverId)?.client;
  const options = {
    ...(input.label ? { label: input.label } : {}),
    ...(input.transport ? { transport: input.transport } : {}),
  };
  const result =
    desktop?.invoke && input.serverId === input.localServerId
      ? await desktop.invoke("desktop_start_hub", { serverId: input.serverId, ...options })
      : await client?.startLocalHub(options);
  return (result ?? {}) as Partial<HubLocalStartResult>;
}

const HUB_STATUS_TIMEOUT_MS = 3_000;

/** The connected Host that runs this Hub: its daemon is enrolled with the Hub at a
 * loopback origin, which only a Hub on the same machine has. Hosts are asked in parallel
 * with a short limit, so one stalled Host cannot hold the answer for the RPC timeout. */
export async function findHubHost(
  hubId: string,
  serverIds: readonly string[],
): Promise<string | null> {
  const runsHub = await Promise.all(serverIds.map((serverId) => hostRunsHub(serverId, hubId)));
  return serverIds.find((_, index) => runsHub[index]) ?? null;
}

async function hostRunsHub(serverId: string, hubId: string): Promise<boolean> {
  const client = getHostRuntimeStore().getSnapshot(serverId)?.client;
  if (!client?.getLastServerInfoMessage()?.features?.hubDiscovery) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), HUB_STATUS_TIMEOUT_MS);
  });
  const status = await Promise.race([
    client.getHubStatus().then(
      (response) => response.status,
      () => null,
    ),
    timedOut,
  ]);
  clearTimeout(timer);
  return Boolean(
    status?.hubOrigin &&
    status.hubConnection?.hubId === hubId &&
    isLoopbackOrigin(status.hubOrigin),
  );
}

/** Re-runs this Hub on its Host over Tailscale and, once the new HTTPS origin proves to be
 * the same Hub, saves it on this device. */
export async function setUpHubTailscale(input: {
  profile: HubProfile;
  serverId: string;
  localServerId: string | null;
}): Promise<HostTailscale> {
  const result = await startHubOnHost({
    serverId: input.serverId,
    localServerId: input.localServerId,
    transport: "tailscale",
  });
  if (result.transport === "tailscale" && isTailscaleOrigin(result.origin)) {
    await saveVerifiedHubRoutes(input.profile, {
      origin: result.origin,
      relay: result.hub?.relay ?? input.profile.relay,
    });
    return { state: "ready", origin: result.origin };
  }
  return {
    state: result.tailscaleState ?? "unavailable",
    ...(result.networkGuidance ? { guidance: result.networkGuidance } : {}),
  };
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}
