import { useCallback, useRef, useState } from "react";
import { toErrorMessage } from "@/utils/error-messages";

export type ProviderRefresh = (provider: string) => void | Promise<void>;

interface RefreshState {
  provider: string | null;
  pending: boolean;
  error: string | null;
}

const IDLE: RefreshState = { provider: null, pending: false, error: null };

/**
 * Refreshes one provider's model list in place, through the same snapshot refresh Settings uses.
 * A second press while one runs is ignored; a failure stays beside the list with Retry.
 */
export function useProviderRefresh(refresh: ProviderRefresh | undefined) {
  const [state, setState] = useState<RefreshState>(IDLE);
  const inFlight = useRef<string | null>(null);
  const run = useCallback(
    async (provider: string) => {
      if (!refresh || inFlight.current !== null) return;
      inFlight.current = provider;
      setState({ provider, pending: true, error: null });
      try {
        await refresh(provider);
        setState({ provider, pending: false, error: null });
      } catch (error) {
        setState({ provider, pending: false, error: toErrorMessage(error) });
      } finally {
        inFlight.current = null;
      }
    },
    [refresh],
  );
  return {
    available: refresh !== undefined,
    run,
    isPending: (provider: string) => state.pending && state.provider === provider,
    errorFor: (provider: string) => (state.provider === provider ? state.error : null),
  };
}

export type ProviderRefreshControl = ReturnType<typeof useProviderRefresh>;
