import type { QueryClient } from "@tanstack/react-query";

export function daemonsQueryKey(accountId: string, organizationId: string) {
  return ["daemons", accountId, organizationId] as const;
}

export async function refreshDaemons(
  queryClient: QueryClient,
  accountId: string,
  organizationId: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: daemonsQueryKey(accountId, organizationId),
    refetchType: "all",
  });
}
