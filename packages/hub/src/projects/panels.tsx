/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-array-as-prop, eslint-plugin-react-perf/jsx-no-new-function-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop, eslint-plugin-react-perf/jsx-no-jsx-as-prop, typescript-eslint/no-unsafe-type-assertion -- route links and mutation controls are intentionally scoped to each rendered tenant snapshot */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { CONNECTION_MUTATION_KEY } from "../auth/tenant-mutation.js";
import { useActiveAccount } from "../auth/active-account.js";
import { ConfirmAction, ConfirmMenuItem } from "../components/app/confirm-action.js";
import { DataCell, DataRow, DataTable } from "../components/app/data-table.js";
import { EmptyState } from "../components/app/empty-state.js";
import { PageHeader } from "../components/app/page.js";
import { RowActions } from "../components/app/row-actions.js";
import { Section } from "../components/app/section.js";
import { StatusPill } from "../components/app/status-pill.js";
import { ProviderGlyph } from "../connections/provider-glyph.js";
import { connectionResultCopy, useConnectionResult } from "../connections/result.js";
import { cn } from "../lib/utils.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { DaemonsPanel } from "../daemons/account-daemons.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Field, FieldLabel } from "../components/ui/field.js";
import { Input } from "../components/ui/input.js";
import type { Result } from "../contract/respond.js";
import {
  connectionStatus,
  disconnectConnection,
  startConnection,
  type ConnectionDisconnectResult,
  type ConnectionStatus,
} from "../connections/functions.js";
import { useRouteTenant } from "./context.js";
import type { ProjectDashboard } from "./dashboard.js";
import {
  CommandError,
  formatDate,
  invalidateOrganization,
  invalidateScope,
  projectScope,
  queryState,
  useOrganizationSnapshot,
  useProjectCommand,
  useProjectSnapshot,
  type OrganizationSnapshot,
  type ProjectSnapshot,
} from "./panel-state.js";
import {
  archiveProject,
  activityRunSnapshot,
  createProject,
  updateProjectSlug,
} from "./functions.js";
export function ProjectsPanel() {
  const tenant = useRouteTenant();
  const queryClient = useQueryClient();
  const scope = { organizationSlug: tenant.organization.slug };
  const snapshot = useOrganizationSnapshot();
  const [connectionResult] = useConnectionResult();
  const [creating, setCreating] = useState(false);
  const create = useProjectCommand(createProject, queryClient, scope);
  if (!snapshot.ok) return snapshot.element;
  const data = snapshot.data;
  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({
      data: {
        ...scope,
        name: formString(form, "name"),
        slug: formString(form, "slug"),
      },
    });
    setCreating(false);
  };
  return (
    <>
      <PageHeader title="Projects" description="Select a project to work in.">
        {data.capabilities.manageResources ? (
          <Button onClick={() => setCreating(true)}>New project</Button>
        ) : null}
      </PageHeader>
      {connectionResult === undefined ? null : (
        <Alert role="status" className="mb-6">
          <AlertDescription>{connectionResultCopy(connectionResult)}</AlertDescription>
        </Alert>
      )}
      <CommandError mutations={[create]} />
      {data.projects.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState
            title="No projects"
            description="Create a project to route provider events at a daemon."
          />
        </div>
      ) : (
        <ul aria-label="Projects" className="grid gap-2">
          {data.projects.map((project) => (
            <li key={project.id}>
              <ProjectCard
                project={project}
                to={`/o/${data.organization.slug}/projects/${project.slug}/overview`}
              />
            </li>
          ))}
        </ul>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <form aria-label="Create project" className="grid gap-5" onSubmit={submitCreate}>
            <LabeledInput label="Project name" name="name" required />
            <LabeledInput
              label="Project slug"
              name="slug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
            />
            <DialogFooter>
              <Button type="submit">Create project</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The project chooser row. Choosing a project is the whole job of that screen, so the
 * card itself is the target rather than the name inside a cell. Archived projects keep
 * their row but lose every affordance — their routes stop resolving once archived.
 */
function ProjectCard({
  project,
  to,
}: {
  project: OrganizationSnapshot["projects"][number];
  to: string;
}) {
  const card = "flex items-center gap-4 rounded-lg border bg-card px-4 py-3.5";
  const body = (
    <>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-sm text-link"
      >
        {monogram(project.name)}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate group-hover:text-link">{project.name}</span>
          {project.status === "active" ? null : <StatusPill tone="neutral">Archived</StatusPill>}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{project.slug}</span>
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        Created {formatDate(project.createdAt)}
      </span>
    </>
  );
  if (project.status !== "active") {
    return <div className={cn(card, "opacity-60")}>{body}</div>;
  }
  return (
    <Link
      to={to as never}
      className={cn(card, "group transition-colors hover:border-primary/60 hover:bg-accent/40")}
    >
      {body}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}

function monogram(name: string) {
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
}

export function OrganizationConnectionsPanel() {
  const tenant = useRouteTenant();
  const { isInstanceOperator } = useActiveAccount();
  const queryClient = useQueryClient();
  const scope = { organizationSlug: tenant.organization.slug };
  const snapshot = useOrganizationSnapshot();
  const loadStatus = useServerFn(connectionStatus);
  const statusQuery = useQuery({
    queryKey: ["connection-status", tenant.account.id, tenant.organization.id],
    queryFn: () => loadStatus({ data: scope }),
  });
  const [result, setResult] = useConnectionResult();
  const connect = useMutation({
    mutationKey: CONNECTION_MUTATION_KEY,
    mutationFn: useServerFn(startConnection),
  });
  const disconnect = useMutation({
    mutationKey: CONNECTION_MUTATION_KEY,
    mutationFn: useServerFn(disconnectConnection) as (
      input: Parameters<typeof disconnectConnection>[0],
    ) => Promise<Result<{ result: ConnectionDisconnectResult }>>,
    onSuccess: async (response) => {
      if (response.status !== "ok") return;
      setResult(response.data.result);
      await Promise.all([
        invalidateOrganization(queryClient, scope.organizationSlug),
        queryClient.invalidateQueries({
          queryKey: ["connection-status", tenant.account.id, tenant.organization.id],
        }),
      ]);
    },
  });
  if (!snapshot.ok) return snapshot.element;
  const status = queryState<ConnectionStatus>(statusQuery, "Connections unavailable");
  if (!status.ok) return status.element;
  const data = snapshot.data;
  const connectProvider = (provider: "github" | "discord" | "slack" | "linear") => {
    connect.mutate(
      { data: { ...scope, provider } },
      {
        onSuccess: (response) => {
          if (response.status === "ok") window.location.assign(response.data.url);
        },
      },
    );
  };
  const rows = connectionRows(data);
  const busy = connect.isPending || disconnect.isPending;
  const connectionActionLabel = (provider: "github" | "discord" | "slack" | "linear") => {
    if (
      (provider === "slack" || provider === "linear") &&
      status.data[provider].status === "requiresReauthorization"
    ) {
      return "Reauthorize";
    }
    if (
      provider === "github" &&
      rows.some(
        (connection) => connection.provider === "github" && connection.status === "suspended",
      )
    ) {
      return "Reconnect";
    }
    return "Connect";
  };
  return (
    <>
      <PageHeader title="Connections" description="Organization provider connections." />
      {result === undefined ? null : (
        <Alert role="status" className="mb-6">
          <AlertDescription>{connectionResultCopy(result)}</AlertDescription>
        </Alert>
      )}
      <CommandError mutations={[connect, disconnect]} />
      <Section title="Connections">
        <DataTable
          label="Connections"
          columns={[
            { header: "Connection" },
            { header: "Provider" },
            { header: "Status" },
            { header: "" },
          ]}
          isEmpty={rows.length === 0}
          empty={{ title: "No connections" }}
        >
          {rows.map((connection) => (
            <DataRow key={`${connection.provider}-${connection.id}`}>
              <DataCell>
                <span>{connection.name}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {connection.externalId}
                </span>
              </DataCell>
              <DataCell>
                <span className="inline-flex items-center gap-1.5">
                  <ProviderGlyph provider={connection.provider} />
                  {providerLabel(connection.provider)}
                </span>
              </DataCell>
              <DataCell>
                <StatusPill
                  tone={
                    connection.status === "suspended" ||
                    connection.status === "requiresReauthorization"
                      ? "warning"
                      : "success"
                  }
                >
                  {statusLabel(connection.status)}
                </StatusPill>
              </DataCell>
              <DataCell align="end">
                {data.capabilities.manageResources ? (
                  <RowActions label={`Actions for ${connection.name}`}>
                    <ConfirmMenuItem
                      busy={busy}
                      destructive
                      label="Revoke"
                      title={`Revoke ${connection.name}?`}
                      description="Projects using this credential will stop receiving new events."
                      confirmLabel="Revoke connection"
                      cancelLabel="Cancel"
                      onConfirm={() =>
                        disconnect.mutate({
                          data: {
                            ...scope,
                            provider: connection.provider,
                            connectionId: connection.id,
                          },
                        })
                      }
                    />
                  </RowActions>
                ) : null}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
        {data.capabilities.manageResources ? (
          <div className="grid gap-2 sm:grid-cols-4">
            {(["github", "discord", "slack", "linear"] as const).map((provider) => (
              <div
                key={provider}
                className="flex items-center justify-between gap-2 rounded-md border p-3"
              >
                <span className="inline-flex items-center gap-2 text-sm">
                  <ProviderGlyph provider={provider} />
                  {providerLabel(provider)}
                </span>
                {status.data[provider].status === "notConfigured" ? (
                  <UnconfiguredProvider provider={provider} operator={isInstanceOperator} />
                ) : (
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() => connectProvider(provider)}
                  >
                    {connectionActionLabel(provider)} {providerLabel(provider)}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </Section>
      <Section
        title="Known unrouted events"
        description="Events received for this organization that were not routed to a workflow."
      >
        <ActivityTable activity={data.unroutedEvents} label="Unrouted events" showReason />
      </Section>
    </>
  );
}

export function OrganizationDaemonsPanel() {
  const tenant = useRouteTenant();
  return (
    <DaemonsPanel
      accountId={tenant.account.id}
      organizationId={tenant.organization.id}
      organizationSlug={tenant.organization.slug}
    />
  );
}

export function ProjectOverviewPanel() {
  const tenant = useRouteTenant();
  const snapshot = useProjectSnapshot();
  if (!snapshot.ok) return snapshot.element;
  const data = snapshot.data;
  const base = `/o/${tenant.organization.slug}/projects/${data.project.slug}`;
  return (
    <>
      <PageHeader
        title="Overview"
        description={`Setup and recent operations for ${data.project.name}.`}
      />
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <SetupCard
          label="Configuration"
          ready={data.configuration.activeRevision !== null}
          detail={
            data.configuration.activeRevision === null
              ? "No active revision"
              : `Revision ${String(data.configuration.activeRevision.version)}`
          }
        />
        <SetupCard
          label="Connections"
          ready={
            data.connections.github.length +
              data.connections.discord.length +
              data.connections.slack.length +
              data.connections.linear.length >
            0
          }
          detail={`${String(data.connections.github.length + data.connections.discord.length + data.connections.slack.length + data.connections.linear.length)} organization connections`}
        />
      </div>
      <Section
        title="Recent activity"
        action={
          <Link className="text-sm hover:underline" to={`${base}/activity` as never}>
            View all
          </Link>
        }
      >
        <ActivityTable
          activity={data.activity.slice(0, 5)}
          label="Recent activity"
          detailBasePath={`${base}/activity`}
        />
      </Section>
    </>
  );
}

export function ProjectActivityPanel() {
  const tenant = useRouteTenant();
  const snapshot = useProjectSnapshot();
  if (!snapshot.ok) return snapshot.element;
  return (
    <>
      <PageHeader title="Activity" description="Provider events routed to this project." />
      <ActivityTable
        activity={snapshot.data.activity}
        label="Project activity"
        detailBasePath={`/o/${tenant.organization.slug}/projects/${tenant.project?.slug}/activity`}
      />
    </>
  );
}

export function ProjectActivityRunPanel({ runId }: { runId: string }) {
  const tenant = useRouteTenant();
  const load = useServerFn(activityRunSnapshot);
  const scope = {
    organizationSlug: tenant.organization.slug,
    projectSlug: tenant.project?.slug ?? "",
    runId,
  };
  const query = useQuery({
    queryKey: ["project-activity-run", tenant.account.id, tenant.organization.id, runId],
    queryFn: () => load({ data: scope }),
  });
  const snapshot = queryState<Awaited<ReturnType<ProjectDashboard["activityRunSnapshot"]>>>(
    query,
    "Run unavailable",
  );
  if (!snapshot.ok) return snapshot.element;
  const activity = snapshot.data.activity;
  return (
    <>
      <PageHeader
        title="Run detail"
        description={`${activity.provider} · ${activity.configuredTriggerName}`}
      />
      <div className="grid gap-6">
        <Section title="Invocation">
          <dl className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2">
            <DetailField label="Prompt">
              <pre className="whitespace-pre-wrap text-sm">{activity.prompt}</pre>
            </DetailField>
            <DetailField label="Typed inputs">
              <JsonValue value={activity.inputs} />
            </DetailField>
            <DetailField label="Composed routing values">
              <JsonValue value={activity.values} />
            </DetailField>
            <DetailField label="Run status">
              <StatusPill tone={executionTone(activity.status)}>{activity.status}</StatusPill>
            </DetailField>
            <DetailField label="Run deadline">
              <span className="font-mono text-xs">
                {activity.deadlineAt === null ? "—" : formatDate(activity.deadlineAt)}
                {activity.deadlineKind === null ? "" : ` · ${activity.deadlineKind}`}
              </span>
            </DetailField>
            <DetailField label="Failure reason">
              <span>{activity.failureReason ?? "—"}</span>
            </DetailField>
            <DetailField label="Delivery">
              <span className="font-mono text-xs">{activity.deliveryId}</span>
            </DetailField>
          </dl>
        </Section>
        <Section title="Steps" description="Ordered durable step state and structured outputs.">
          <DataTable
            label="Run steps"
            columns={[
              { header: "Step" },
              { header: "Status" },
              { header: "Deadline" },
              { header: "Structured output" },
              { header: "Failure reason" },
            ]}
            isEmpty={activity.steps.length === 0}
            empty={{ title: "No steps" }}
          >
            {activity.steps.map((step) => (
              <DataRow key={step.id}>
                <DataCell>
                  <span>
                    {step.ordinal + 1}. {step.stepId}
                  </span>
                </DataCell>
                <DataCell>
                  <StatusPill tone={executionTone(step.status)}>{step.status}</StatusPill>
                </DataCell>
                <DataCell muted>
                  <span className="font-mono text-xs">
                    {step.deadlineAt === null ? "—" : formatDate(step.deadlineAt)}
                    {step.deadlineKind === null ? "" : ` · ${step.deadlineKind}`}
                    {step.idleDeadlineAt === null
                      ? ""
                      : ` · idle ${formatDate(step.idleDeadlineAt)}`}
                  </span>
                </DataCell>
                <DataCell>
                  <JsonValue value={step.output} />
                </DataCell>
                <DataCell muted>{step.failureReason ?? "—"}</DataCell>
              </DataRow>
            ))}
          </DataTable>
        </Section>
      </div>
    </>
  );
}

export function ProjectGeneralSettingsPanel() {
  const tenant = useRouteTenant();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const scope = projectScope(tenant);
  const snapshot = useProjectSnapshot();
  const updateSlug = useProjectCommand(updateProjectSlug, queryClient, scope);
  // Archiving deletes the route this panel is standing on: the project stops resolving
  // for every project URL. Leave for the project list before invalidating, or the
  // refetch lands on a project route that can no longer answer.
  const archiveProjectFn = useServerFn(archiveProject);
  const archive = useMutation({
    mutationFn: archiveProjectFn,
    onSuccess: async (result) => {
      if (result.status !== "ok") return;
      await navigate({ to: `/o/${tenant.organization.slug}/projects` as never });
      await invalidateScope(queryClient, scope);
    },
  });
  if (!snapshot.ok) return snapshot.element;
  const data = snapshot.data;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const slug = formString(new FormData(event.currentTarget), "slug");
    updateSlug.mutate(
      { data: { ...scope, slug } },
      {
        onSuccess: (result) => {
          if (result.status === "ok")
            void navigate({
              to: `/o/${tenant.organization.slug}/projects/${slug}/settings` as never,
            });
        },
      },
    );
  };
  return (
    <SettingsPage>
      <CommandError mutations={[updateSlug, archive]} />
      {data.capabilities.manageResources ? (
        <>
          <Section
            title="Project URL"
            description="Changing the slug deliberately breaks old project URLs."
          >
            <form
              aria-label="Change project slug"
              className="flex max-w-md items-end gap-2"
              onSubmit={submit}
            >
              <LabeledInput
                label="Project slug"
                name="slug"
                defaultValue={data.project.slug}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                required
              />
              <Button type="submit">Save slug</Button>
            </form>
          </Section>
          <Section title="Archive project">
            <ConfirmAction
              label="Archive project"
              title={`Archive ${data.project.name}?`}
              description="Routing is released; running recovery and history remain."
              confirmLabel="Archive project"
              cancelLabel="Cancel"
              busy={archive.isPending}
              onConfirm={() => archive.mutate({ data: scope })}
            />
          </Section>
        </>
      ) : null}
    </SettingsPage>
  );
}

function SettingsPage({ children }: { children: ReactNode }) {
  const tenant = useRouteTenant();
  if (tenant.project === null) throw new Error("settings route has no project");
  return (
    <>
      <PageHeader title="Settings" description={`Project settings for ${tenant.project.name}.`} />
      {children}
    </>
  );
}

function SetupCard({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return (
    <section aria-label={label} className="rounded-lg border bg-card p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2>{label}</h2>
        <StatusPill tone={ready ? "success" : "neutral"}>
          {ready ? "Ready" : "Setup needed"}
        </StatusPill>
      </div>
      <p className="text-sm text-muted-foreground">{detail}</p>
    </section>
  );
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function JsonValue({ value }: { value: unknown }) {
  return (
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">
      {JSON.stringify(value, null, 2) ?? "—"}
    </pre>
  );
}

function executionTone(status: string): "success" | "danger" | "neutral" {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "timed_out") return "danger";
  return "neutral";
}

function ActivityTable({
  activity,
  label,
  detailBasePath,
  showReason = false,
}: {
  activity: ReadonlyArray<
    | ProjectSnapshot["activity"][number]
    | Awaited<ReturnType<ProjectDashboard["organizationSnapshot"]>>["unroutedEvents"][number]
  >;
  label: string;
  detailBasePath?: string;
  showReason?: boolean;
}) {
  return (
    <DataTable
      label={label}
      columns={[
        { header: "Run" },
        { header: "Provider" },
        { header: "Source" },
        { header: "Status" },
        ...(showReason ? [{ header: "Reason" }] : []),
        { header: "Received" },
      ]}
      isEmpty={activity.length === 0}
      empty={{ title: "No activity" }}
    >
      {activity.map((event) => (
        <DataRow key={event.id}>
          <DataCell>
            {detailBasePath &&
            "configuredTriggerName" in event &&
            event.configuredTriggerName !== null ? (
              <Link className="hover:underline" to={`${detailBasePath}/${event.id}` as never}>
                {event.configuredTriggerName}
              </Link>
            ) : (
              <span className="font-mono text-xs">{event.id.slice(0, 12)}</span>
            )}
            {event.repo === null ? null : (
              <span className="block text-xs text-muted-foreground">{event.repo}</span>
            )}
          </DataCell>
          <DataCell>{event.provider}</DataCell>
          <DataCell>{event.source}</DataCell>
          <DataCell>{"status" in event ? event.status : "dropped"}</DataCell>
          {showReason ? <DataCell>{event.failureReason ?? "Unknown reason"}</DataCell> : null}
          <DataCell muted>{formatDate(event.receivedAt)}</DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

function connectionRows(data: OrganizationSnapshot) {
  return [
    ...data.connections.github.map((connection) => ({
      provider: "github" as const,
      id: connection.id,
      name: connection.slug,
      externalId: `${connection.accountLogin} · installation ${connection.installationId}`,
      status: connection.status,
    })),
    ...data.connections.discord.map((connection) => ({
      provider: "discord" as const,
      id: connection.id,
      name: connection.slug,
      externalId: `guild ${connection.guildId}`,
      status: "connected" as const,
    })),
    ...data.connections.slack.map((connection) => ({
      provider: "slack" as const,
      id: connection.id,
      name: connection.slug,
      externalId: `workspace ${connection.teamId}`,
      status: connection.requiresReauthorization
        ? ("requiresReauthorization" as const)
        : ("connected" as const),
    })),
    ...data.connections.linear.map((connection) => ({
      provider: "linear" as const,
      id: connection.id,
      name: connection.slug,
      externalId: `workspace ${connection.linearOrganizationId}`,
      status: connection.requiresReauthorization
        ? ("requiresReauthorization" as const)
        : ("connected" as const),
    })),
  ];
}
/**
 * An operator can do something about an app that is not set up, so they get the way to do it.
 * A member cannot, and learns nothing about instance credentials either way.
 */
function UnconfiguredProvider({
  provider,
  operator,
}: {
  provider: "github" | "discord" | "slack" | "linear";
  operator: boolean;
}) {
  if (!operator) return <StatusPill tone="neutral">Not configured</StatusPill>;
  return (
    <Link className="text-sm text-link hover:underline" to={"/apps" as never}>
      Set up the {providerLabel(provider)} app
    </Link>
  );
}

function providerLabel(provider: "github" | "discord" | "slack" | "linear") {
  if (provider === "github") return "GitHub";
  if (provider === "discord") return "Discord";
  return provider === "slack" ? "Slack" : "Linear";
}

function statusLabel(status: string): string {
  if (status === "requiresReauthorization") return "Reauthorization required";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
function formString(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
function LabeledInput({
  label,
  name,
  ...props
}: { label: string; name: string } & Omit<React.ComponentProps<typeof Input>, "name">) {
  const id = `field-${name}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} name={name} {...props} />
    </Field>
  );
}
