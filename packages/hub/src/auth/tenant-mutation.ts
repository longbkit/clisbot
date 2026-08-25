import { useIsMutating } from "@tanstack/react-query";

export const TENANT_CONTEXT_MUTATION_KEY = ["tenant-context"] as const;
export const ACCOUNT_MUTATION_KEY = [...TENANT_CONTEXT_MUTATION_KEY, "account"] as const;
export const CONNECTION_MUTATION_KEY = [...TENANT_CONTEXT_MUTATION_KEY, "connections"] as const;
export const DAEMON_MUTATION_KEY = [...TENANT_CONTEXT_MUTATION_KEY, "daemon"] as const;
export const API_KEY_MUTATION_KEY = [...TENANT_CONTEXT_MUTATION_KEY, "api-keys"] as const;

export function useTenantContextMutationPending(): boolean {
  return useIsMutating({ mutationKey: TENANT_CONTEXT_MUTATION_KEY }) > 0;
}
