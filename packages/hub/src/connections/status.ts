import type { QueryClient } from "@tanstack/react-query";
import type { ConnectionProvider, ConnectionStatus } from "./functions.js";

export type ProviderConnectionStatus = ConnectionStatus[ConnectionProvider];

const PROVIDER_NAMES = {
  github: "GitHub",
  discord: "Discord",
  slack: "Slack",
} as const;

export function connectionsQueryKey(accountId: string, organizationId: string) {
  return ["connections", accountId, organizationId] as const;
}

export async function refreshConnections(
  queryClient: QueryClient,
  accountId: string,
  organizationId: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: connectionsQueryKey(accountId, organizationId),
    refetchType: "all",
  });
}

export function hasProviderBinding(status: ProviderConnectionStatus): boolean {
  return (
    status.status === "connected" ||
    status.status === "suspended" ||
    status.status === "requiresReauthorization"
  );
}

export function providerBindingDetail(
  provider: ConnectionProvider,
  status: ProviderConnectionStatus,
): string | undefined {
  if (!hasProviderBinding(status)) return undefined;
  const name = PROVIDER_NAMES[provider];
  if (status.status === "suspended") return `${name} suspended`;
  if (status.status === "requiresReauthorization") return `${name} reauthorization required`;
  return name;
}
