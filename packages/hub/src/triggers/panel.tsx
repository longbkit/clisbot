/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-function-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop -- focused trigger screens bind one document */
/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- generated routes cannot express server-resolved organization URLs */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, Braces, Copy, FileText, LockKeyhole, Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DataCell, DataRow, DataTable } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { SiteHeaderActions } from "../components/app/site-header-actions.js";
import { RelativeTime } from "../components/app/relative-time.js";
import { StatusPill } from "../components/app/status-pill.js";
import { ProviderGlyph } from "../connections/provider-glyph.js";
import { connectionResultCopy, useConnectionResult } from "../connections/result.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Field, FieldDescription, FieldLabel } from "../components/ui/field.js";
import { Input } from "../components/ui/input.js";
import { Textarea } from "../components/ui/textarea.js";
import { CodeEditor } from "../projects/configuration/code-editor.js";
import { useRouteTenant } from "../projects/context.js";
import type { Result } from "../contract/respond.js";
import {
  createTriggerYaml,
  mergeTriggerForm,
  parseEditorEvent,
  projectTriggerForm,
  type TriggerFormValue,
} from "./configuration/editor.js";
import { saveTrigger, triggerSnapshot, type TriggerSnapshot } from "./functions.js";

type BrowserTrigger = TriggerSnapshot["triggers"][number];
type EditorMode = "form" | "yaml";

const TRIGGER_COLUMNS = [
  { header: "Trigger" },
  { header: "Event", className: "hidden md:table-cell" },
  { header: "Target", className: "hidden lg:table-cell" },
  { header: "Last triggered", className: "hidden xl:table-cell" },
  { header: "Status" },
] as const;

export function TriggersPanel() {
  const tenant = useRouteTenant();
  const scope = { organizationSlug: tenant.organization.slug };
  const snapshot = useTriggerSnapshot(scope.organizationSlug);
  const [connectionResult] = useConnectionResult();
  const navigate = useNavigate();
  if (snapshot.isPending) return <div aria-busy="true">Loading triggers…</div>;
  if (snapshot.isError || snapshot.data.status === "error") {
    return <TriggerLoadError result={snapshot.data} />;
  }
  const data = snapshot.data.data;
  const triggerPath = (triggerId: string) =>
    `/o/${scope.organizationSlug}/triggers/${triggerId}` as never;
  return (
    <>
      <PageHeader
        title="Triggers"
        description="Launch agents on your compute when organization events arrive."
      >
        {data.canManage ? (
          <Button asChild>
            <Link to={triggerPath("new")}>
              <Plus className="size-4" /> New trigger
            </Link>
          </Button>
        ) : null}
      </PageHeader>
      {connectionResult === undefined ? null : (
        <Alert role="status" className="mb-6">
          <AlertDescription>{connectionResultCopy(connectionResult)}</AlertDescription>
        </Alert>
      )}
      <DataTable
        label="Triggers"
        columns={TRIGGER_COLUMNS}
        isEmpty={data.triggers.length === 0}
        empty={{
          title: "No triggers",
          description: "Connect a provider and daemon, then create your first trigger.",
        }}
      >
        {data.triggers.map((trigger) => (
          <DataRow
            key={trigger.id}
            onSelect={() => {
              void navigate({ to: triggerPath(trigger.id) });
            }}
          >
            <DataCell>
              <span className="flex min-w-52 items-center gap-3">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-foreground"
                  aria-label={`${trigger.provider} provider`}
                >
                  <ProviderGlyph provider={trigger.provider} />
                </span>
                <span className="min-w-0">
                  <Link
                    to={triggerPath(trigger.id)}
                    className="block truncate hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {trigger.name}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {trigger.format === "legacy_multistep"
                      ? "Legacy YAML"
                      : (trigger.draft?.agent ?? "Advanced YAML")}
                  </span>
                </span>
              </span>
            </DataCell>
            <DataCell muted className="hidden whitespace-nowrap md:table-cell">
              <span className="block text-foreground">{eventLabel(trigger.event)}</span>
              {trigger.draft?.connection === "" ||
              trigger.draft?.connection === undefined ? null : (
                <span className="block text-xs">{trigger.draft.connection}</span>
              )}
            </DataCell>
            <DataCell muted className="hidden whitespace-nowrap lg:table-cell">
              {trigger.draft === null ? (
                "Advanced configuration"
              ) : (
                <>
                  <span className="block text-foreground">{trigger.draft.daemon}</span>
                  <span className="block max-w-48 truncate font-mono text-xs">
                    {trigger.draft.cwd}
                  </span>
                </>
              )}
            </DataCell>
            <DataCell muted className="hidden whitespace-nowrap xl:table-cell">
              {trigger.lastTriggered === null ? (
                "Never"
              ) : (
                <>
                  <span className="block text-foreground">
                    <RelativeTime value={trigger.lastTriggered.receivedAt} />
                  </span>
                  <span className="block text-xs capitalize">{trigger.lastTriggered.status}</span>
                </>
              )}
            </DataCell>
            <DataCell>
              <StatusPill tone={trigger.enabled ? "success" : "neutral"}>
                {trigger.enabled ? "Enabled" : "Disabled"}
              </StatusPill>
            </DataCell>
          </DataRow>
        ))}
      </DataTable>
    </>
  );
}

export function TriggerEditorPanel({ triggerId }: { triggerId: string }) {
  const tenant = useRouteTenant();
  const organizationSlug = tenant.organization.slug;
  const snapshot = useTriggerSnapshot(organizationSlug);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const saveCommand = useServerFn(saveTrigger) as (input: {
    data: { organizationSlug: string; triggerId?: string; yaml: string };
  }) => Promise<Result<{ state: "complete" }>>;
  const save = useMutation({
    mutationFn: saveCommand,
    onSuccess: async (result) => {
      if (result.status !== "ok") return;
      await queryClient.invalidateQueries({ queryKey: ["triggers", organizationSlug] });
      await navigate({ to: `/o/${organizationSlug}/triggers` as never });
    },
  });
  if (snapshot.isPending) return <div aria-busy="true">Loading trigger…</div>;
  if (snapshot.isError || snapshot.data.status === "error") {
    return <TriggerLoadError result={snapshot.data} />;
  }
  const data = snapshot.data.data;
  const trigger = triggerId === "new" ? null : data.triggers.find(({ id }) => id === triggerId);
  if (trigger === undefined) {
    return (
      <Alert>
        <AlertTitle>Trigger not found</AlertTitle>
        <AlertDescription>
          This trigger no longer exists. Return to the trigger list and choose another one.
        </AlertDescription>
      </Alert>
    );
  }
  const returnToList = () => {
    void navigate({ to: `/o/${organizationSlug}/triggers` as never });
  };
  return (
    <TriggerEditor
      key={trigger?.id ?? "new"}
      trigger={trigger}
      snapshot={data}
      saving={save.isPending}
      saveError={save.data?.status === "error" ? save.data.error.message : undefined}
      onCancel={returnToList}
      onSave={(yaml) =>
        save.mutate({
          data: {
            organizationSlug,
            ...(trigger?.id === undefined ? {} : { triggerId: trigger.id }),
            yaml,
          },
        })
      }
    />
  );
}

function useTriggerSnapshot(organizationSlug: string) {
  const load = useServerFn(triggerSnapshot);
  return useQuery({
    queryKey: ["triggers", organizationSlug],
    queryFn: () => load({ data: { organizationSlug } }),
  });
}

function TriggerLoadError({ result }: { result: Result<TriggerSnapshot> | undefined }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Triggers unavailable</AlertTitle>
      <AlertDescription>
        {result?.status === "error"
          ? result.error.message
          : "Hub couldn't load this organization's triggers."}
      </AlertDescription>
    </Alert>
  );
}

function TriggerEditor({
  trigger,
  snapshot,
  saving,
  saveError,
  onCancel,
  onSave,
}: {
  trigger: BrowserTrigger | null;
  snapshot: TriggerSnapshot;
  saving: boolean;
  saveError: string | undefined;
  onCancel: () => void;
  onSave: (yaml: string) => void;
}) {
  const legacy = trigger?.format === "legacy_multistep";
  const editor = useTriggerEditorState(trigger, snapshot, legacy, onSave);
  const title = trigger === null ? "New trigger" : trigger.name;
  const submitLabel = triggerSubmitLabel(saving, trigger === null);
  const footerSubmitLabel = editor.mode === "yaml" && !saving ? "Save YAML" : submitLabel;
  const saveDisabled = saving || !snapshot.canManage || legacy;
  return (
    <>
      <SiteHeaderActions>
        <div
          className="inline-flex rounded-md border bg-background p-0.5 shadow-xs"
          aria-label="Editor mode"
        >
          <ModeButton
            active={editor.mode === "form"}
            disabled={legacy}
            onClick={() => editor.switchMode("form")}
            icon="form"
          >
            Form
          </ModeButton>
          <ModeButton
            active={editor.mode === "yaml"}
            onClick={() => editor.switchMode("yaml")}
            icon="yaml"
          >
            YAML
          </ModeButton>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Discard
        </Button>
        <Button type="submit" form="trigger-editor-form" size="sm" disabled={saveDisabled}>
          {submitLabel}
        </Button>
      </SiteHeaderActions>
      <Button variant="ghost" size="sm" className="mb-4 -ml-3" onClick={onCancel}>
        <ArrowLeft className="size-4" /> Triggers
      </Button>
      <PageHeader
        title={title}
        status={{
          label: editor.form.enabled ? "Enabled" : "Disabled",
          tone: editor.form.enabled ? "success" : "neutral",
        }}
        description="One event launches one agent on your compute."
      >
        <EnabledSwitch
          checked={editor.form.enabled}
          onChange={(enabled) => editor.setForm({ ...editor.form, enabled })}
        />
      </PageHeader>
      <TriggerCompatibilityAlert
        legacy={legacy}
        advanced={editor.mode === "yaml" && editor.yamlOnly}
      />
      {saveError === undefined && editor.error === undefined ? null : (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>{editor.error ?? saveError}</AlertDescription>
        </Alert>
      )}
      <form id="trigger-editor-form" className="grid gap-5" onSubmit={editor.submit}>
        {editor.mode === "yaml" ? (
          <div className="relative h-[68vh] min-h-96 overflow-hidden rounded-lg border bg-card">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="absolute top-3 right-3 z-10"
              onClick={() => void navigator.clipboard.writeText(editor.yaml)}
            >
              <Copy /> Copy YAML
            </Button>
            <CodeEditor
              value={editor.yaml}
              language="yaml"
              readOnly={!snapshot.canManage || legacy}
              label="Trigger YAML"
              onChange={editor.setYaml}
            />
          </div>
        ) : (
          <TriggerForm
            form={editor.form}
            triggerId={trigger?.id}
            snapshot={snapshot}
            onChange={editor.setForm}
          />
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saveDisabled}>
            {footerSubmitLabel}
          </Button>
        </div>
      </form>
    </>
  );
}

function triggerSubmitLabel(saving: boolean, creating: boolean) {
  if (saving) return "Saving…";
  return creating ? "Create trigger" : "Save changes";
}

function useTriggerEditorState(
  trigger: BrowserTrigger | null,
  snapshot: TriggerSnapshot,
  legacy: boolean,
  onSave: (yaml: string) => void,
) {
  const initialForm = trigger?.draft ?? defaultForm(snapshot);
  const initialYaml = trigger?.yaml ?? createTriggerYaml(initialForm);
  const initialProjection = projectTriggerForm(initialYaml);
  const [mode, setMode] = useState<EditorMode>(
    trigger === null || (initialProjection.status === "editable" && !legacy) ? "form" : "yaml",
  );
  const [yaml, setYaml] = useState(initialYaml);
  const [form, setForm] = useState<TriggerFormValue>(
    initialProjection.status === "editable" ? initialProjection.value : initialForm,
  );
  const [error, setError] = useState<string>();
  const switchMode = (next: EditorMode) => {
    setError(undefined);
    if (next === mode) return;
    if (next === "yaml") {
      try {
        setYaml(mergeTriggerForm(yaml, form));
        setMode("yaml");
        window.scrollTo({ top: 0 });
      } catch (cause) {
        setError(message(cause));
      }
      return;
    }
    const projection = projectTriggerForm(yaml);
    if (projection.status === "yaml_only") {
      setError(projection.reason);
      return;
    }
    setForm(projection.value);
    setMode("form");
    window.scrollTo({ top: 0 });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      onSave(mode === "form" ? mergeTriggerForm(yaml, form) : yaml);
      setError(undefined);
    } catch (cause) {
      setError(message(cause));
    }
  };
  return {
    mode,
    yaml,
    form,
    error,
    yamlOnly: initialProjection.status === "yaml_only",
    setYaml,
    setForm,
    switchMode,
    submit,
  };
}

function TriggerCompatibilityAlert({ legacy, advanced }: { legacy: boolean; advanced: boolean }) {
  if (!legacy && !advanced) return null;
  return (
    <Alert className="mb-5">
      <AlertTriangle className="size-4" />
      <AlertTitle>{legacy ? "Legacy multi-step workflow" : "Advanced trigger"}</AlertTitle>
      <AlertDescription>
        {legacy
          ? "This workflow remains runnable. Copy this YAML and use the migration guide to replace it with one self-contained trigger per event. Form editing is disabled."
          : "This YAML uses features the form cannot represent. Edit it directly; Hub will preserve every advanced field."}
      </AlertDescription>
    </Alert>
  );
}

function TriggerForm({
  form,
  triggerId,
  snapshot,
  onChange,
}: {
  form: TriggerFormValue;
  triggerId: string | undefined;
  snapshot: TriggerSnapshot;
  onChange: (value: TriggerFormValue) => void;
}) {
  const provider = form.event.split(".")[0];
  const connections = snapshot.connections.filter((connection) => connection.provider === provider);
  const githubConnections = snapshot.connections.filter(
    (connection) => connection.provider === "github",
  );
  const githubEnabled = form.githubConnection !== "";
  const [githubExpanded, setGithubExpanded] = useState(githubEnabled);
  const everyone = form.allowedUsers.trim() === "*";
  const update = <Key extends keyof TriggerFormValue>(key: Key, value: TriggerFormValue[Key]) =>
    onChange({ ...form, [key]: value });
  return (
    <div className="grid gap-5">
      <FormSection
        number="1"
        title="Trigger details"
        description="Identification and system handle for this trigger."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <ControlledInput
            label="Trigger name"
            value={form.name}
            onChange={(value) => update("name", value)}
            description="Lowercase identifier with hyphens, for example slack-triage."
            required
          />
          <Field>
            <FieldLabel htmlFor="trigger-id">Trigger ID</FieldLabel>
            <Input id="trigger-id" value={triggerId ?? "Assigned when saved"} disabled />
            <FieldDescription>Immutable identifier within this organization.</FieldDescription>
          </Field>
        </div>
      </FormSection>

      <FormSection
        number="2"
        title="Event & access"
        description="When this event fires and who is authorized to invoke it."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="trigger-event">When this happens</FieldLabel>
            <select
              id="trigger-event"
              value={form.event}
              onChange={(event) => update("event", parseEditorEvent(event.target.value))}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="slack.mention">Slack mention (slack.mention)</option>
              <option value="discord.mention">Discord mention (discord.mention)</option>
              <option value="github.issue_comment">
                GitHub issue comment (github.issue_comment)
              </option>
              <option value="linear.issue_created">
                Linear issue created (linear.issue_created)
              </option>
              <option value="manual.run">Manual run (manual.run)</option>
            </select>
            <FieldDescription>Exactly one event launches this trigger.</FieldDescription>
          </Field>
          {form.event === "manual.run" ? null : (
            <Field>
              <FieldLabel htmlFor="trigger-connection">Connection</FieldLabel>
              <select
                id="trigger-connection"
                value={form.connection}
                onChange={(event) => update("connection", event.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
                required
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.slug}>
                    {connection.label}
                  </option>
                ))}
              </select>
              <FieldDescription>
                The organization connection that receives the event.
              </FieldDescription>
            </Field>
          )}
        </div>
        {form.event === "manual.run" ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Who can trigger it?</FieldLabel>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={everyone ? "default" : "outline"}
                  onClick={() => update("allowedUsers", "*")}
                >
                  Everyone
                </Button>
                <Button
                  type="button"
                  variant={!everyone ? "default" : "outline"}
                  onClick={() => update("allowedUsers", "")}
                >
                  Specific people
                </Button>
              </div>
            </Field>
            {everyone ? null : (
              <ControlledInput
                label="User IDs"
                value={form.allowedUsers}
                onChange={(value) => update("allowedUsers", value)}
                description="Comma-separated provider user IDs."
                required
              />
            )}
          </div>
        )}
      </FormSection>

      <FormSection
        number="3"
        title="Run target"
        description="The local machine compute and repository working directory."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="trigger-daemon">Run on daemon</FieldLabel>
            <select
              id="trigger-daemon"
              value={form.daemon}
              onChange={(event) => update("daemon", event.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
              required
            >
              {snapshot.daemons.map((daemon) => (
                <option key={daemon.id} value={daemon.slug}>
                  {daemon.slug} ({daemon.presence})
                </option>
              ))}
            </select>
            <FieldDescription>
              The daemon owns compute, credentials, and sandboxing.
            </FieldDescription>
          </Field>
          <ControlledInput
            label="Working directory"
            value={form.cwd}
            onChange={(value) => update("cwd", value)}
            description="Absolute path on the daemon."
            required
          />
          <ControlledInput
            label="Maximum runtime"
            value={form.maxRuntime}
            onChange={(value) => update("maxRuntime", value)}
            description="Hard deadline for the agent, for example 2h."
            required
          />
          <ControlledInput
            label="Idle timeout"
            value={form.idleTimeout}
            onChange={(value) => update("idleTimeout", value)}
            description="Stop an unresponsive agent, for example 10m."
            required
          />
        </div>
      </FormSection>

      <FormSection
        number="4"
        title="Agent & instructions"
        description="The AI coding agent model and task prompt instructions."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <ControlledInput
            label="Agent ID"
            value={form.agent}
            onChange={(value) => update("agent", value)}
            description="Full provider/model ID, for example codex/gpt-5.4."
            required
          />
          <ControlledInput
            label="Execution mode"
            value={form.mode}
            onChange={(value) => update("mode", value)}
            description="Provider mode, for example full-access."
            required
          />
          <ControlledInput
            label="Thinking option ID"
            value={form.thinkingOptionId}
            onChange={(value) => update("thinkingOptionId", value)}
            description="Leave blank to use the provider's default thinking option."
          />
        </div>
        <details className="rounded-md border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm">Advanced provider options (JSON)</summary>
          <Field className="mt-3">
            <FieldLabel htmlFor="trigger-provider-options" className="sr-only">
              Advanced provider options (JSON)
            </FieldLabel>
            <Textarea
              id="trigger-provider-options"
              value={form.providerOptions}
              onChange={(event) => update("providerOptions", event.target.value)}
              rows={5}
              placeholder={'{"sandbox_mode":"workspace-write"}'}
            />
            <FieldDescription>
              Passed to the provider on your daemon. YAML-only agent fields remain untouched.
            </FieldDescription>
          </Field>
        </details>
        <details
          className="rounded-md border bg-muted/20 p-3"
          open={githubExpanded}
          onToggle={(event) => setGithubExpanded(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-sm">GitHub access</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="trigger-github-connection">GitHub connection</FieldLabel>
              <select
                id="trigger-github-connection"
                value={form.githubConnection}
                onChange={(event) => update("githubConnection", event.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Do not inject a GitHub token</option>
                {githubConnections.map((connection) => (
                  <option key={connection.id} value={connection.slug}>
                    {connection.label}
                  </option>
                ))}
              </select>
              <FieldDescription>
                Mints a short-lived, restricted GH_TOKEN for this run.
              </FieldDescription>
            </Field>
            {githubEnabled ? (
              <>
                <ControlledInput
                  label="GitHub repositories"
                  value={form.githubRepositories}
                  onChange={(value) => update("githubRepositories", value)}
                  description="Comma-separated owner/repository names."
                  required
                />
                <ControlledInput
                  label="GitHub token lifetime"
                  value={form.githubDuration}
                  onChange={(value) => update("githubDuration", value)}
                  description="At most 1h."
                  required
                />
                <Field>
                  <FieldLabel htmlFor="trigger-github-permissions">
                    GitHub permissions (JSON)
                  </FieldLabel>
                  <Textarea
                    id="trigger-github-permissions"
                    value={form.githubPermissions}
                    onChange={(event) => update("githubPermissions", event.target.value)}
                    rows={4}
                    placeholder={'{"contents":"write","pull_requests":"write"}'}
                  />
                  <FieldDescription>
                    Defaults to read-only repository contents when empty.
                  </FieldDescription>
                </Field>
              </>
            ) : null}
          </div>
        </details>
        <PromptEditor value={form.prompt} onChange={(prompt) => update("prompt", prompt)} />
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <LockKeyhole className="size-4 shrink-0 text-link" />
          Hub launches the agent on your daemon. Keys, provider configuration, and sandboxing stay
          on your compute.
        </div>
      </FormSection>
    </div>
  );
}

function FormSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`trigger-section-${number}`}
      className="overflow-hidden rounded-lg border bg-card"
    >
      <header className="flex items-start gap-3 border-b bg-muted/20 px-5 py-4">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs text-muted-foreground">
          {number}
        </span>
        <div>
          <h2 id={`trigger-section-${number}`} className="text-sm">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="grid gap-5 p-5">{children}</div>
    </section>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: "form" | "yaml";
  children: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-xs transition-colors [&_svg]:size-3.5 ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"} disabled:opacity-40`}
    >
      {icon === "form" ? <FileText /> : <Braces />}
      {children}
    </button>
  );
}

function EnabledSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="relative h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-primary after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
      {checked ? "Enabled" : "Disabled"}
    </label>
  );
}

function PromptEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (element === null) return;
    element.style.height = "0px";
    element.style.height = `${String(element.scrollHeight)}px`;
  }, [value]);
  const insert = (mergeTag: string) => {
    const element = textarea.current;
    if (element === null) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    onChange(`${value.slice(0, start)}${mergeTag}${value.slice(end)}`);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + mergeTag.length, start + mergeTag.length);
    });
  };
  return (
    <Field>
      <FieldLabel htmlFor="trigger-prompt">Instructions</FieldLabel>
      <Textarea
        ref={textarea}
        id="trigger-prompt"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={8}
        className="min-h-48 resize-none overflow-hidden font-mono text-xs leading-6"
        required
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Insert merge tag:</span>
        {["${{ paseo.prompt }}", "${{ paseo.context }}"].map((mergeTag) => (
          <Button
            key={mergeTag}
            type="button"
            variant="outline"
            size="xs"
            className="font-mono"
            onClick={() => insert(mergeTag)}
          >
            {mergeTag}
          </Button>
        ))}
      </div>
    </Field>
  );
}

function ControlledInput({
  label,
  value,
  description,
  required,
  onChange,
}: {
  label: string;
  value: string;
  description?: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const id = `trigger-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function defaultForm(snapshot: TriggerSnapshot): TriggerFormValue {
  const slack = snapshot.connections.find(({ provider }) => provider === "slack");
  return {
    name: "new-trigger",
    enabled: true,
    event: slack === undefined ? "manual.run" : "slack.mention",
    connection: slack?.slug ?? "",
    allowedUsers: "*",
    daemon: snapshot.daemons[0]?.slug ?? "",
    cwd: "/workspace",
    agent: "codex/gpt-5.4",
    mode: "full-access",
    thinkingOptionId: "",
    providerOptions: "",
    maxRuntime: "2h",
    idleTimeout: "10m",
    githubConnection: "",
    githubRepositories: "",
    githubPermissions: "",
    githubDuration: "1h",
    prompt:
      "Handle this request in the originating conversation.\n\nWhen hub.reply is available, use it for useful progress updates and your final user-facing response. Call hub.finish_execution once the request is complete.\n\nRequest:\n${{ paseo.prompt }}",
  };
}

function eventLabel(event: string): string {
  if (event === "slack.mention") return "Slack mention";
  if (event === "discord.mention") return "Discord mention";
  if (event === "github.issue_comment") return "GitHub issue comment";
  if (event === "linear.issue_created") return "Linear issue created";
  if (event === "manual.run") return "Manual run";
  return event;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The trigger is invalid.";
}
