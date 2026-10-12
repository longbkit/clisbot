import { useMemo, useRef } from "react";
import equal from "fast-deep-equal";
import { type HubProfile, useHubProfiles } from "@/device-access/hub-profiles";
import { getHubConfiguration, type HubConfiguration } from "./config";

/** One Hub this app keeps an account controller running for. */
export interface HubAccountScopeConfiguration {
  /** Stable scope for caches and managed relationships; `hub://<id>` for a saved Hub. */
  origin: string;
  configuration: HubConfiguration;
}

// The registry validates every mutation with Zod, which clones all profiles. Compare
// connection inputs rather than object identity; labels do not affect transport.
function profileScope(
  profile: HubProfile,
  previous: HubAccountScopeConfiguration | undefined,
): HubAccountScopeConfiguration {
  if (
    previous &&
    equal(connectionInputs(profile), connectionInputs(previous.configuration.deviceProfile))
  )
    return previous;
  const origin = `hub://${profile.hubId}`;
  return { origin, configuration: { origin, deviceProfile: profile } };
}

function connectionInputs(profile: HubProfile | undefined) {
  return [
    profile?.hubId,
    profile?.publicKey,
    profile?.origin,
    profile?.relay?.endpoint,
    profile?.relay?.useTls,
    profile?.entry,
    profile?.setupStatus,
  ];
}

/**
 * Every saved Hub, and which one the Hub screens show. Without saved Hubs, the Hub this build
 * or page is configured with is the only one.
 */
export function useHubAccountScopes(): {
  scopes: HubAccountScopeConfiguration[];
  activeOrigin: string | null;
} {
  const registry = useHubProfiles();
  const savedRef = useRef(new Map<string, HubAccountScopeConfiguration>());
  const configuredRef = useRef<HubAccountScopeConfiguration | null>(null);
  return useMemo(() => {
    if (registry.profiles.length === 0) {
      savedRef.current.clear();
      const configured = getHubConfiguration();
      if (configured === null) return { scopes: [], activeOrigin: null };
      if (configuredRef.current?.origin !== configured.origin)
        configuredRef.current = { origin: configured.origin, configuration: configured };
      return { scopes: [configuredRef.current], activeOrigin: configured.origin };
    }
    const scopes = registry.profiles.map((profile) =>
      profileScope(profile, savedRef.current.get(`hub://${profile.hubId}`)),
    );
    savedRef.current = new Map(scopes.map((scope) => [scope.origin, scope]));
    const active = scopes.find(
      (scope) => scope.configuration.deviceProfile?.hubId === registry.activeId,
    );
    return { scopes, activeOrigin: active?.origin ?? null };
  }, [registry]);
}
