import { useCallback, useEffect, useMemo, useState } from "react";
import { useHubAccount } from "@/clisbot/hub/account-provider";
import { i18n } from "@/i18n/i18next";
import { PairedHubTransport } from "./hub-transport";
import type { HubProfile } from "./hub-profiles";
import { readHubDeviceCapabilities, type HubDeviceCapabilities } from "./hub-capabilities";

interface CapabilityState {
  scope: PairedHubTransport | null;
  capabilities: HubDeviceCapabilities | null;
  error: Error | null;
}

/** Account refresh keeps the transport and in-progress form in the same Hub scope. */
export function useHubDeviceCapabilities(profile: HubProfile | undefined) {
  const account = useHubAccount();
  const transport = useMemo(() => (profile ? new PairedHubTransport(profile) : null), [profile]);
  const [state, setState] = useState<CapabilityState>({
    scope: null,
    capabilities: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => () => transport?.close(), [transport]);
  useEffect(() => {
    let alive = true;
    setState((previous) => ({
      scope: transport,
      capabilities: previous.scope === transport ? previous.capabilities : null,
      error: null,
    }));
    if (transport)
      void readHubDeviceCapabilities(transport)
        .then((capabilities) => {
          if (alive) setState({ scope: transport, capabilities, error: null });
          return undefined;
        })
        .catch((caught) => {
          if (alive)
            setState({
              scope: transport,
              capabilities: null,
              error:
                caught instanceof Error
                  ? caught
                  : new Error(i18n.t("hub.connection.errors.connectionFailed")),
            });
        });
    return () => {
      alive = false;
    };
  }, [transport, account.connection, attempt]);
  const current = state.scope === transport;
  return {
    transport,
    capabilities: current ? state.capabilities : null,
    error: current ? state.error : null,
    retry,
  };
}
