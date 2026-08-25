import { useIsMutating, useMutationState } from "@tanstack/react-query";
import { z } from "zod";
import { ACCOUNT_MUTATION_KEY } from "./tenant-mutation.js";

export { ACCOUNT_MUTATION_KEY };
export const ACCOUNT_MUTATION_FAILURE =
  "Hub did not receive the account update. Check your connection, reload the current account state, and submit again.";

const failedResultSchema = z.object({
  status: z.literal("error"),
  error: z.object({ message: z.string() }),
});

export function useAccountMutationError(): string | undefined {
  const messages = useMutationState({
    filters: { mutationKey: ACCOUNT_MUTATION_KEY },
    select: (mutation) => {
      const result = failedResultSchema.safeParse(mutation.state.data);
      if (result.success) return result.data.error.message;
      return mutation.state.status === "error" ? ACCOUNT_MUTATION_FAILURE : undefined;
    },
  });
  return messages.at(-1);
}

export function useAccountMutationPending(): boolean {
  return useIsMutating({ mutationKey: ACCOUNT_MUTATION_KEY }) > 0;
}
