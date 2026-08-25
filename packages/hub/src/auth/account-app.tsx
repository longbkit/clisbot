import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState } from "react";
import { accountState } from "./functions.js";
import { DaemonHandoffEntry } from "../daemons/handoff.js";
import { AccountEntry, InvitationEntry, OrganizationGate } from "./account-entry.js";
import { FailedEntry, LoadingEntry, UnavailableInvitation } from "./account-states.js";
import { DashboardShell } from "./dashboard-shell.js";
import { InstanceSetupEntry } from "./instance-setup-entry.js";
import { AppSetupEntry } from "../provider-applications/panel.js";
import { PasswordChangeEntry } from "./password-change.js";

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
  const state = account.data.data;
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
