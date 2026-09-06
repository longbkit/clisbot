import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { isWeb } from "@/constants/platform";
import { useHubAccount } from "./account-provider";
import { hubAccountEntryRoute, hubClientAuthorizationContinuation } from "./account-entry-route";

/** Routes Hub account-entry links into the shared Paseo Settings shell. */
export function HubAccountEntryNavigation({ navigationReady }: { navigationReady: boolean }) {
  const hub = useHubAccount();
  const router = useRouter();
  const url = Linking.useURL();
  const target = useMemo(() => hubAccountEntryRoute(url), [url]);

  useEffect(() => {
    if (!navigationReady || !hub.enabled || target === null) return;
    router.replace(target);
  }, [hub.enabled, navigationReady, router, target]);

  useEffect(() => {
    if (
      !isWeb ||
      !hub.enabled ||
      hub.loading ||
      hub.signInKind !== "password" ||
      hub.origin === null ||
      typeof window === "undefined"
    ) {
      return;
    }
    const destination = hubClientAuthorizationContinuation({
      url,
      origin: hub.origin,
      state: hub.state,
    });
    if (destination !== null) window.location.replace(destination);
  }, [hub.enabled, hub.loading, hub.origin, hub.signInKind, hub.state, url]);

  return null;
}
