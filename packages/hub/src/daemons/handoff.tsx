/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- the generated route type cannot express a server-resolved organization slug */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { TriangleAlert } from "lucide-react";
import { useCallback } from "react";
import { AuthCard, AuthLayout } from "../components/app/auth-layout.js";
import { CopyField } from "../components/app/copy-field.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import type { Result } from "../contract/respond.js";
import { daemonList, type BrowserDaemonList } from "./functions.js";
import { daemonsQueryKey } from "./status.js";

const POLL_INTERVAL_MS = 2_000;

/**
 * The origin `paseo hub login` resolves to when it is given no argument (`DEFAULT_HUB_ORIGIN` in
 * the CLI). Every other Hub has to be named on the command line, so the argument is omitted only
 * when this Hub is that one — no deployment flag, and nothing to configure per instance.
 */
const HOSTED_HUB_ORIGIN = "https://hub.paseo.sh";

/** The exact command to paste into a terminal on the machine that will run the agents. */
export function daemonLoginCommand(origin: string): string {
  return origin === HOSTED_HUB_ORIGIN ? "paseo hub login" : `paseo hub login ${origin}`;
}

/**
 * Where both ways out of the handoff land: the project every organization is provisioned with
 * (`provisionOrganization` in src/organizations/provisioning.ts names it). Onboarding ends inside
 * the operator's project, not on a list asking them to pick the only entry it has.
 */
export function defaultProjectRoute(organizationSlug: string): string {
  return `/o/${organizationSlug}/projects/default/overview`;
}

/**
 * What the operator is waiting on, decided outside React so every state has a name and a test.
 * A link that has already been made outranks a failed poll: a success is never taken back
 * because the next request timed out.
 */
export type DaemonLink =
  | { state: "checking" }
  | { state: "waiting" }
  | { state: "failed"; message: string }
  | { state: "linked"; slug: string };

export function daemonLink(snapshot: {
  isPending: boolean;
  isError: boolean;
  data: Result<BrowserDaemonList> | undefined;
}): DaemonLink {
  const connected =
    snapshot.data?.status === "ok"
      ? snapshot.data.data.daemons.find(
          (daemon) => daemon.status === "active" && daemon.presence === "connected",
        )
      : undefined;
  if (connected !== undefined) return { state: "linked", slug: connected.slug };
  if (snapshot.data?.status === "error") {
    return { state: "failed", message: snapshot.data.error.message };
  }
  if (snapshot.isError) {
    return {
      state: "failed",
      message: "Hub didn't answer. Check your connection, then check again.",
    };
  }
  if (snapshot.isPending) return { state: "checking" };
  return { state: "waiting" };
}

/**
 * The step between app setup and the dashboard. App onboarding is already complete on the server
 * by the time this renders, so the terminal's own browser tab reaches the CLI authorization page
 * instead of being sent back into setup — this screen is a client-side phase, not a gate.
 */
export function DaemonHandoffEntry({
  accountId,
  organizationId,
  organizationSlug,
  onContinue,
}: {
  accountId: string;
  organizationId: string;
  organizationSlug: string;
  onContinue: () => void;
}) {
  const load = useServerFn(daemonList);
  const snapshot = useQuery({
    queryKey: daemonsQueryKey(accountId, organizationId),
    queryFn: () => load({ data: { organizationSlug } }),
    refetchInterval: POLL_INTERVAL_MS,
  });
  const refetch = snapshot.refetch;
  const retry = useCallback(() => void refetch(), [refetch]);
  const navigate = useNavigate();
  /**
   * Connecting and skipping end the same way: inside the default project. The route has to be
   * committed before the phase is dropped — dropping it first would render the dashboard at
   * whatever URL onboarding happens to be standing on, and flash the project list on the way.
   */
  const leave = useCallback(() => {
    void (async () => {
      await navigate({ to: defaultProjectRoute(organizationSlug) as never });
      onContinue();
    })();
  }, [navigate, onContinue, organizationSlug]);
  return (
    <DaemonHandoffView
      link={daemonLink(snapshot)}
      // The address the operator reached this Hub at is the address their daemon has to be told.
      // Only a click in app setup reaches this step, so there is no server render to guard.
      command={daemonLoginCommand(window.location.origin)}
      onRetry={retry}
      onContinue={leave}
    />
  );
}

export function DaemonHandoffView({
  link,
  command,
  onRetry,
  onContinue,
}: {
  link: DaemonLink;
  command: string;
  onRetry: () => void;
  onContinue: () => void;
}) {
  if (link.state === "linked") {
    return (
      <AuthLayout width="md">
        <AuthCard
          title="Daemon connected"
          description={`${link.slug} is connected to this Hub. Finish the starter workflow in your terminal whenever you're ready.`}
          descriptionRole="status"
        >
          <Button onClick={onContinue}>Continue</Button>
        </AuthCard>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout width="md">
      <AuthCard
        title="Connect a daemon"
        description="Hub runs your workflows on daemons you own. Run this on the machine where your code lives:"
      >
        <CopyField label="Command" value={command} />
        <p className="text-sm text-muted-foreground">
          Your terminal signs you in, connects this daemon, and offers to set up a starter workflow.
        </p>
        <LinkProgress link={link} onRetry={onRetry} />
        <Button variant="ghost" onClick={onContinue}>
          Do this later
        </Button>
      </AuthCard>
    </AuthLayout>
  );
}

/**
 * Waiting is the ordinary case and reads as a quiet status line. A failed check is the one thing
 * the operator can act on here, so it gets an alert and its own retry — the command stays on
 * screen either way, because nothing about it has changed.
 */
function LinkProgress({ link, onRetry }: { link: DaemonLink; onRetry: () => void }) {
  if (link.state === "failed") {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Hub couldn't check for daemons</AlertTitle>
        <AlertDescription>
          <p>{link.message}</p>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Check again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
      {link.state === "checking" ? "Checking for daemons…" : "Waiting for a daemon to connect…"}
    </p>
  );
}
