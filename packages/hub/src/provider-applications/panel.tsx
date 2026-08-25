/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-function-as-prop -- open/close handlers are bound per rendered provider section */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { completeAppSetup } from "../auth/functions.js";
import { useActiveAccount } from "../auth/active-account.js";
import { AuthLayout } from "../components/app/auth-layout.js";
import { PageHeader } from "../components/app/page.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { TriangleAlert } from "lucide-react";
import { Button } from "../components/ui/button.js";
import type { Result } from "../contract/respond.js";
import { PROVIDER_GUIDES } from "./guides.js";
import { providerApplicationsOverview } from "./functions.js";
import { ProviderSection, ProviderSectionLoading, type SectionReturn } from "./provider-section.js";
import type { Provider, ProviderApplicationOverview, ProviderApplicationSurface } from "./index.js";

const OVERVIEW_KEY = ["provider-applications"] as const;

/**
 * One cached overview for the whole surface. The journey frame reads it to decide whether the
 * way out reads as finishing, and the sections read it for their own state; sharing the query
 * key means both see exactly the same answer.
 */
function useProviderApplicationsOverview() {
  const load = useServerFn(providerApplicationsOverview);
  return useQuery({ queryKey: OVERVIEW_KEY, queryFn: () => load(), refetchInterval: 1_000 });
}

function connectedProviderCount(overview: ProviderApplicationOverview): number {
  return Object.values(overview.providers).filter((view) => view.connections.length > 0).length;
}

/**
 * The app setup surface. One component, two frames: the first-run journey renders it full
 * screen so nothing about the dashboard appears before the operator has a reason to see it,
 * and Instance → Apps renders the identical sections inside the shell.
 */
function ProviderApplications({
  surface,
  organizationId,
}: {
  surface: ProviderApplicationSurface;
  organizationId: string;
}) {
  const [returned] = useState(readAppReturn);
  const [open, setOpen] = useState<Partial<Record<Provider, boolean>>>(() =>
    returned === undefined ? {} : { [returned.provider]: true },
  );
  const query = useProviderApplicationsOverview();
  const section = useRef<HTMLDivElement>(null);
  useEffect(stripAppReturn, []);
  useEffect(() => {
    if (returned !== undefined) section.current?.scrollIntoView({ block: "start" });
  }, [returned]);

  if (query.isPending) return <OverviewLoading />;
  if (query.isError || query.data.status === "error") {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Your apps couldn't be loaded</AlertTitle>
        <AlertDescription>
          {query.data?.status === "error"
            ? query.data.error.message
            : "Hub did not answer. Check your connection, then reload the page."}
        </AlertDescription>
      </Alert>
    );
  }
  const overview = query.data.data;
  return (
    <div className="grid min-w-0 gap-3">
      {PROVIDER_GUIDES.map((guide) => (
        <div
          key={guide.provider}
          className="min-w-0"
          {...(returned?.provider === guide.provider ? { ref: section } : {})}
        >
          <ProviderSection
            guide={guide}
            view={overview.providers[guide.provider]}
            callbackOrigin={overview.callbackOrigin}
            surface={surface}
            organizationId={organizationId}
            // Closed until the operator picks one, or until a provider's own return has
            // something to show them. Three open manuals is not a choice, it is a wall.
            open={open[guide.provider] ?? false}
            onOpenChange={(next) => setOpen((current) => ({ ...current, [guide.provider]: next }))}
            {...(returned?.provider === guide.provider
              ? { returned: returned.outcome }
              : { returned: undefined })}
          />
        </div>
      ))}
    </div>
  );
}

function OverviewLoading() {
  return (
    <div aria-label="Loading your apps" aria-busy="true" className="grid gap-3">
      {PROVIDER_GUIDES.map((guide) => (
        <ProviderSectionLoading key={guide.provider} guide={guide} open={false} />
      ))}
    </div>
  );
}

/**
 * First run. The operator has an account and an organization and nothing else; the dashboard
 * would introduce projects before there is any reason to explain them.
 *
 * Leaving is a server fact — app onboarding is complete the moment the request succeeds, so a CLI
 * authorization opened in another tab is no longer sent back here. Where the operator goes next
 * is the journey's decision, not this surface's: `onLeft` is called once the server agrees.
 */
export function AppSetupEntry({
  organizationId,
  onLeft,
}: {
  organizationId: string;
  onLeft: () => void;
}) {
  const queryClient = useQueryClient();
  const overview = useProviderApplicationsOverview();
  const connected = overview.data?.status === "ok" ? connectedProviderCount(overview.data.data) : 0;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const finish = useMutation({
    mutationFn: useServerFn(completeAppSetup) as (
      input: Parameters<typeof completeAppSetup>[0],
    ) => Promise<Result<Record<string, never>>>,
    onSuccess: async (response) => {
      if (response.status !== "ok") return;
      await queryClient.invalidateQueries({ queryKey: ["account"] });
      onLeft();
    },
  });
  const done = useCallback(() => finish.mutate({}), [finish]);
  const exitFailure = useRef<HTMLDivElement>(null);
  const failure = exitFailureMessage(finish);
  // The operator pressed a button and stayed where they were. Say why, where they are looking.
  useEffect(() => {
    if (failure !== undefined) exitFailure.current?.focus();
  }, [failure]);
  return (
    <AuthLayout width="xl">
      <div className="grid min-w-0 gap-6">
        <div className="grid gap-1.5">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight outline-none"
          >
            Set up your apps
          </h1>
          <p className="text-sm text-balance text-muted-foreground">
            Paseo Hub talks to GitHub, Slack, and Discord through apps you create and own. Set up
            the ones you want to use.
          </p>
        </div>
        <ExitFailure ref={exitFailure} message={exitFailureMessage(finish)} onRetry={done} />
        <ProviderApplications surface="appSetup" organizationId={organizationId} />
        <div className="sticky bottom-0 -mx-6 border-t bg-background px-6 py-4 sm:static sm:mx-0 sm:flex sm:justify-end sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
          <Button
            className="w-full sm:w-auto"
            variant={connected > 0 ? "default" : "ghost"}
            disabled={finish.isPending}
            onClick={done}
          >
            {connected > 0 ? "Finish" : "Do this later"}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}

/**
 * Why leaving app setup did not work.
 *
 * A rejected request and a request that never arrived are different failures with the same
 * consequence: the operator is still here and nothing has changed. The server owns the first and
 * says so itself; the second never reached a server, so this page is the only thing that can
 * report it, and it does rather than swallowing the press.
 */
function exitFailureMessage(finish: {
  data: Result<Record<string, never>> | undefined;
  isError: boolean;
}): string | undefined {
  if (finish.data?.status === "error") return finish.data.error.message;
  if (finish.isError) {
    return "Hub didn't get the request, so nothing changed. Check your connection, then try again.";
  }
  return undefined;
}

function ExitFailure({
  ref,
  message,
  onRetry,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  message: string | undefined;
  onRetry: () => void;
}) {
  if (message === undefined) return null;
  return (
    <Alert ref={ref} tabIndex={-1} variant="destructive">
      <TriangleAlert />
      <AlertTitle>Hub couldn't leave app setup</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Instance → Apps. The same sections, later, with no journey wrapped around them. */
export function AppsPanel() {
  const account = useActiveAccount();
  return (
    <>
      <PageHeader
        title="Apps"
        description="The GitHub, Slack, and Discord apps Hub uses to reach your workspaces."
      />
      <div className="max-w-5xl">
        <ProviderApplications surface="apps" organizationId={account.organization.id} />
      </div>
    </>
  );
}

interface AppReturn {
  provider: Provider;
  outcome: SectionReturn;
}

/**
 * Every outcome a provider can send an operator back with. Each one says what happened and what
 * to do next; a cancellation is neutral because nothing about it is broken.
 */
const RETURN_MESSAGES: Readonly<Record<string, SectionReturn>> = {
  github_connected: { tone: "success", message: "GitHub connected." },
  slack_connected: { tone: "success", message: "Slack connected." },
  discord_connected: { tone: "success", message: "Discord connected." },
  github_cancelled: {
    tone: "success",
    message: "Installation cancelled at GitHub. Nothing changed. Start again when you're ready.",
  },
  slack_cancelled: {
    tone: "success",
    message: "Installation cancelled at Slack. Nothing changed. Start again when you're ready.",
  },
  discord_cancelled: {
    tone: "success",
    message: "Authorization cancelled at Discord. Nothing changed. Start again when you're ready.",
  },
  github_approval_required: {
    tone: "error",
    message:
      "A GitHub organization owner has to approve this installation. Nothing was connected. Ask an owner to approve the request, then install again.",
  },
  slack_bot_failed: {
    tone: "error",
    message:
      "Slack installed the app without every permission Hub needs. Nothing was saved. Reapply the manifest under Features → OAuth & Permissions, then install again.",
  },
  provider_not_configured: {
    tone: "error",
    message: "There are no saved credentials to connect yet. Verify and save the app first.",
  },
  connection_invalid: {
    tone: "error",
    message:
      "That connection link had already been used or had expired, so it was refused. Nothing was connected. Start the connection again from this page.",
  },
  connection_conflict: {
    tone: "error",
    message:
      "That account is already connected to another organization. Nothing was connected. Disconnect it there, or pick a different one.",
  },
};

/**
 * Reads the outcome an install or authorization came back with. The identity itself is read from
 * the refreshed overview — the query only says which section to open and what happened.
 */
function readAppReturn(): AppReturn | undefined {
  if (typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  const provider = url.searchParams.get("app");
  const result = url.searchParams.get("result");
  if (provider !== "github" && provider !== "slack" && provider !== "discord") return undefined;
  if (result === null) return undefined;
  return {
    provider,
    outcome: RETURN_MESSAGES[result] ?? {
      tone: "error",
      message: `${providerName(provider)} ended the connection without saying why. Nothing was connected. Start the connection again from this page.`,
    },
  };
}

function providerName(provider: Provider): string {
  if (provider === "github") return "GitHub";
  if (provider === "slack") return "Slack";
  return "Discord";
}

/** Clear callback state after the router commits, so its initial URL cannot restore the query. */
function stripAppReturn(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("app") && !url.searchParams.has("result")) return;
  url.searchParams.delete("app");
  url.searchParams.delete("result");
  window.history.replaceState(window.history.state, "", url);
}
