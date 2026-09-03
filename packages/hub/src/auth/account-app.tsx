import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { accountState } from "./functions.js";
import { DaemonHandoffEntry } from "../daemons/handoff.js";
import { AccountEntry, InvitationEntry, OrganizationGate } from "./account-entry.js";
import { FailedEntry, LoadingEntry, UnavailableInvitation } from "./account-states.js";
import { DashboardShell } from "./dashboard-shell.js";
import { InstanceSetupEntry } from "./instance-setup-entry.js";
import { AppSetupEntry } from "../provider-applications/panel.js";
import { PasswordChangeEntry } from "./password-change.js";
import { PASEO_CLIENT_ID } from "./client-authorization.js";
import type { AccountState } from "./organization-contract.js";

const AUTHORIZATION_QUERY_FIELDS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "nonce",
  "prompt",
] as const;

export function AccountApp() {
  const loadAccount = useServerFn(accountState);
  /**
   * The first-run phase between finishing app setup and the dashboard. A phase, not a gate: app
   * onboarding is already complete on the server, so this tab is the only thing that remembers
   * it, the CLI's own tab reaches its authorization page, and a reload lands on the dashboard.
   */
  const [handoff, setHandoff] = useState(false);
  const enterHandoff = useCallback(() => setHandoff(true), []);
  const leaveHandoff = useCallback(() => setHandoff(false), []);
  const invitation =
    typeof window === "undefined"
      ? undefined
      : (new URLSearchParams(window.location.search).get("invitation") ?? undefined);
  const account = useQuery({
    queryKey: ["account", invitation],
    queryFn: () => loadAccount({ data: { invitation } }),
  });
  if (account.isPending) return <LoadingEntry />;
  if (account.isError || account.data.status === "error") {
    return (
      <FailedEntry
        message={
          account.data?.status === "error"
            ? account.data.error.message
            : "Hub did not receive your account state. Check your connection and reload the page."
        }
      />
    );
  }
  return (
    <ResolvedAccountApp
      state={account.data.data}
      handoff={handoff}
      enterHandoff={enterHandoff}
      leaveHandoff={leaveHandoff}
    />
  );
}

function ResolvedAccountApp({
  state,
  handoff,
  enterHandoff,
  leaveHandoff,
}: {
  state: AccountState;
  handoff: boolean;
  enterHandoff(): void;
  leaveHandoff(): void;
}) {
  const authorizationQuery = readClientAuthorizationQuery();
  if (
    authorizationQuery !== null &&
    (state.status === "appSetupRequired" || state.status === "active")
  ) {
    return <ClientAuthorizationContinuation query={authorizationQuery} />;
  }
  if (handoff && (state.status === "appSetupRequired" || state.status === "active")) {
    return (
      <DaemonHandoffEntry
        accountId={state.account.id}
        organizationId={state.organization.id}
        organizationSlug={state.organization.slug}
        onContinue={leaveHandoff}
      />
    );
  }
  if (state.status === "instanceSetupRequired") return <InstanceSetupEntry />;
  if (state.status === "passwordChangeRequired")
    return <PasswordChangeEntry account={state.account} />;
  if (state.status === "appSetupRequired") {
    return <AppSetupEntry organizationId={state.organization.id} onLeft={enterHandoff} />;
  }
  if (state.invitationUnavailable === true) {
    return <UnavailableInvitation message="This invitation is unavailable." />;
  }
  if (state.status === "signedOut") return <AccountEntry account={state} />;
  if (state.invitation !== undefined) {
    return <InvitationEntry account={state} invitation={state.invitation} />;
  }
  if (state.status === "organizationRequired") return <OrganizationGate account={state} />;
  return <DashboardShell account={state} />;
}

/** Returns the signed-in browser to the pending first-party OAuth authorization request. */
function ClientAuthorizationContinuation({ query }: { query: string }) {
  const destination = useMemo(() => {
    const url = new URL("/api/auth/oauth2/authorize", window.location.origin);
    url.search = query;
    return url.toString();
  }, [query]);
  useEffect(() => window.location.replace(destination), [destination]);
  return <LoadingEntry />;
}

function readClientAuthorizationQuery(): string | null {
  if (typeof window === "undefined") return null;
  const current = new URLSearchParams(window.location.search);
  if (current.get("client_id") !== PASEO_CLIENT_ID) return null;
  const query = new URLSearchParams();
  for (const field of AUTHORIZATION_QUERY_FIELDS) {
    for (const value of current.getAll(field)) query.append(field, value);
  }
  return query.has("redirect_uri") && query.has("code_challenge") ? query.toString() : null;
}
