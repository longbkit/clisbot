import { useHubAccount } from "@/clisbot/hub/account-provider";
/** Persistent UI preferences belong to a principal, not a transport admission epoch. */
export function useResourcePrincipalScope(): string {
  const hub = useHubAccount();
  if (hub.signedIn)
    return JSON.stringify([hub.origin, hub.signedIn.account.id, hub.signedIn.organization.id]);
  return hub.enabled ? "signed-out" : "local";
}
