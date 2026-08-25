/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-array-as-prop, eslint-plugin-react-perf/jsx-no-new-function-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop, eslint-plugin-react-perf/jsx-no-jsx-as-prop, typescript-eslint/no-unsafe-type-assertion -- controls are scoped to the rendered project snapshot */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "../../components/app/page.js";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { ProviderGlyph } from "../../connections/provider-glyph.js";
import type { Result } from "../../contract/respond.js";
import { cn } from "../../lib/utils.js";
import { useRouteTenant } from "../context.js";
import type { ManualConfigurationSaveResult } from "../dashboard.js";
import {
  availableGitHubRepositories,
  saveManualConfiguration,
  switchConfigurationToManual,
  syncProjectConfiguration,
  useGitHubConfiguration,
} from "../functions.js";
import {
  CommandError,
  formatDate,
  projectScope,
  useProjectCommand,
  useProjectSnapshot,
  type ProjectSnapshot,
} from "../panel-state.js";
import { RepositoryCombobox, type ComboboxRepository } from "../repository-combobox.js";
import { CodeEditor } from "./code-editor.js";
import {
  addPartial,
  addWorkflow,
  configurationDraft,
  documentsOf,
  editSelected,
  isModified,
  PartialPathUnavailable,
  removePartial,
  removeWorkflow,
  selectDocument,
  selectedDocument,
  type ConfigurationDraft,
} from "./draft.js";

type Configuration = ProjectSnapshot["configuration"];

export function ProjectConfigurationPanel() {
  const tenant = useRouteTenant();
  if (tenant.project === null) throw new Error("configuration route has no project");
  return <ProjectConfigurationScreen key={tenant.project.id} />;
}

function ProjectConfigurationScreen() {
  const tenant = useRouteTenant();
  const queryClient = useQueryClient();
  const scope = projectScope(tenant);
  const snapshot = useProjectSnapshot();
  const sync = useProjectCommand(syncProjectConfiguration, queryClient, scope);
  const manual = useProjectCommand(switchConfigurationToManual, queryClient, scope);
  const save = useProjectCommand<
    Parameters<typeof saveManualConfiguration>[0],
    ManualConfigurationSaveResult
  >(saveManualConfiguration, queryClient, scope);
  const configure = useProjectCommand(useGitHubConfiguration, queryClient, scope);
  const loadRepositories = useServerFn(availableGitHubRepositories);
  const repositories = useQuery({
    queryKey: ["github-repositories", tenant.organization.id, tenant.project?.id],
    queryFn: () => loadRepositories({ data: scope }),
  });
  const [sourceMode, setSourceMode] = useState<"manual" | "github" | null>(null);
  const [stagedRepository, setStagedRepository] = useState<ComboboxRepository | null>(null);
  if (!snapshot.ok) return snapshot.element;
  const data = snapshot.data;
  const configuration = data.configuration;
  const mode = sourceMode ?? configuration.authority;
  const selectMode = (next: "manual" | "github") => {
    setSourceMode(next);
    setStagedRepository(null);
    if (next === "manual" && configuration.authority === "github") manual.mutate({ data: scope });
  };
  return (
    <>
      <PageHeader
        title="Configuration"
        description={`Setup and source for ${data.project.name}.`}
      />
      <CommandError mutations={[sync, manual, save, configure]} />
      <ManualConfigurationResult result={save.data} />
      <ConfigurationWorkbench
        key={configuration.activeRevision?.id ?? "none"}
        configuration={configuration}
        editable={data.capabilities.manageResources && configuration.authority === "manual"}
        savePending={save.isPending || manual.isPending}
        onSave={(draft) =>
          save.mutate({
            data: { ...scope, files: [...draft.files] },
          })
        }
        source={
          <ConfigurationSource
            configuration={configuration}
            manageResources={data.capabilities.manageResources}
            mode={mode}
            onSelectMode={selectMode}
            switchToManualPending={manual.isPending}
            repositories={repositories.data?.status === "ok" ? repositories.data.data : []}
            repositoriesLoading={repositories.isPending}
            stagedRepository={stagedRepository}
            onStageRepository={setStagedRepository}
            onSaveRepository={() => {
              if (stagedRepository === null) return;
              configure.mutate(
                {
                  data: {
                    ...scope,
                    connectionId: stagedRepository.connectionId,
                    repositoryId: stagedRepository.repositoryId,
                  },
                },
                { onSuccess: () => setStagedRepository(null) },
              );
            }}
            saveRepositoryPending={configure.isPending}
            onSync={() => sync.mutate({ data: scope })}
            syncPending={sync.isPending}
          />
        }
      />
    </>
  );
}

/**
 * The screen: source and files on the left rail, the open document on the right.
 * Mounted per active revision, so activating one reopens the editor on it and an
 * invalid save leaves the operator's draft untouched.
 */
function ConfigurationWorkbench({
  configuration,
  editable,
  savePending,
  onSave,
  source,
}: {
  configuration: Configuration;
  editable: boolean;
  savePending: boolean;
  onSave: (draft: ConfigurationDraft) => void;
  source: React.ReactNode;
}) {
  const revision = configuration.activeRevision;
  const [baseline] = useState(() => configurationDraft({ files: revision?.files ?? [] }));
  const [draft, setDraft] = useState(baseline);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<"workflow" | "partial" | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const document = selectedDocument(draft);
  const modified = isModified(draft, baseline);
  const stopEditing = () => {
    setEditing(false);
    setAdding(null);
    setPathError(null);
  };
  return (
    <section
      aria-label="Configuration editor"
      // The row tracks are bounded like the columns are: an `auto` row would size to
      // the open document and push the editor past this fixed height, where
      // `overflow-hidden` would clip it with nothing left to scroll.
      className="grid h-[70svh] min-h-[30rem] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border bg-card md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-5 overflow-y-auto border-b p-4 md:border-r md:border-b-0">
        {source}
        <RevisionSummary revision={revision} />
        <FileList
          draft={draft}
          editing={editing}
          adding={adding}
          pathError={pathError}
          onSelect={(id) => setDraft(selectDocument(draft, id))}
          onStartAdding={(kind) => {
            setAdding(kind);
            setPathError(null);
          }}
          onAdd={(kind, path) => {
            try {
              setDraft(kind === "workflow" ? addWorkflow(draft, path) : addPartial(draft, path));
              setAdding(null);
              setPathError(null);
            } catch (error) {
              if (!(error instanceof PartialPathUnavailable)) throw error;
              setPathError(error.message);
            }
          }}
          onCancelAdding={() => {
            setAdding(null);
            setPathError(null);
          }}
          onRemove={(path) =>
            setDraft(
              path.endsWith(".yml") ? removeWorkflow(draft, path) : removePartial(draft, path),
            )
          }
        />
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <span className="truncate font-mono text-xs">{document.label}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              editing ? "bg-warning-surface text-warning" : "bg-muted text-muted-foreground",
            )}
          >
            {editing ? "Editing" : "Read-only"}
          </span>
          <span className="flex-1" />
          {!editable && configuration.authority === "github" ? (
            <span className="text-xs text-muted-foreground">
              GitHub-managed. Switch the source to Manual to change it here.
            </span>
          ) : null}
          {editable && !editing ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
          {editing ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={savePending}
                onClick={() => {
                  setDraft(baseline);
                  stopEditing();
                }}
              >
                Discard
              </Button>
              <Button
                size="sm"
                disabled={savePending}
                aria-busy={savePending}
                onClick={() => onSave(draft)}
              >
                Save and activate
              </Button>
            </>
          ) : null}
        </div>
        <div className="min-h-0 flex-1">
          <CodeEditor
            value={document.content}
            language={document.language}
            readOnly={!editing}
            label={document.isPartial ? document.label : "Configuration YAML"}
            onChange={(content) => setDraft(editSelected(draft, content))}
          />
        </div>
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
          <span>{revisionState(revision)}</span>
          {modified ? <span className="text-warning">Unsaved changes</span> : null}
          <span className="flex-1" />
          <span>{`${String(draft.files.length)} file${draft.files.length === 1 ? "" : "s"}`}</span>
        </div>
      </div>
    </section>
  );
}

function revisionState(revision: Configuration["activeRevision"]): string {
  if (revision === null) return "Not activated";
  return revision.validation === "valid" ? "Valid" : "Invalid";
}

function RevisionSummary({ revision }: { revision: Configuration["activeRevision"] }) {
  return (
    <div className="grid gap-1.5">
      <RailLabel>Active revision</RailLabel>
      {revision === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          No active configuration.
        </p>
      ) : (
        <div className="rounded-md border px-2.5 py-2">
          <p className="text-sm font-medium">Revision {revision.version}</p>
          <p className="text-xs text-muted-foreground">
            {revision.sourceKind === "github" ? "GitHub-managed" : "Manual"} ·{" "}
            {formatDate(revision.createdAt)}
          </p>
        </div>
      )}
    </div>
  );
}

function FileList({
  draft,
  editing,
  adding,
  pathError,
  onSelect,
  onStartAdding,
  onAdd,
  onCancelAdding,
  onRemove,
}: {
  draft: ConfigurationDraft;
  editing: boolean;
  adding: "workflow" | "partial" | null;
  pathError: string | null;
  onSelect: (id: string) => void;
  onStartAdding: (kind: "workflow" | "partial") => void;
  onAdd: (kind: "workflow" | "partial", path: string) => void;
  onCancelAdding: () => void;
  onRemove: (path: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <RailLabel>Files</RailLabel>
        {editing && adding === null ? (
          <span className="flex gap-2">
            <button
              type="button"
              className="text-xs text-link hover:underline"
              onClick={() => onStartAdding("workflow")}
            >
              Add workflow
            </button>
            <button
              type="button"
              className="text-xs text-link hover:underline"
              onClick={() => onStartAdding("partial")}
            >
              Add partial
            </button>
          </span>
        ) : null}
      </div>
      <ul aria-label="Configuration files" className="grid gap-0.5">
        {documentsOf(draft).map((document) => (
          <li key={document.id} className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              aria-current={document.id === draft.selectedId}
              onClick={() => onSelect(document.id)}
              className={cn(
                "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left font-mono text-xs",
                document.id === draft.selectedId
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
                document.isPartial ? "pl-4" : "",
              )}
            >
              {document.id}
            </button>
            {editing && (document.isPartial || document.isWorkflow) ? (
              <button
                type="button"
                aria-label={`Remove ${document.id}`}
                className="rounded px-1 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(document.id)}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {adding !== null ? (
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const path = form.get("filePath");
            onAdd(adding, typeof path === "string" ? path : "");
          }}
        >
          <Input
            name="filePath"
            aria-label={adding === "workflow" ? "Workflow file name" : "Partial path"}
            placeholder={adding === "workflow" ? "triage.yml" : "triage/preamble.md"}
            className="h-8 font-mono text-xs"
          />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm">
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancelAdding}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {pathError === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {pathError}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Workflow YAML lives directly under <span className="font-mono">.paseo/workflows/</span>;
        shared prompt files live under <span className="font-mono">partials/</span>. Saving
        activates the complete bundle.
      </p>
    </div>
  );
}

function ConfigurationSource({
  configuration,
  manageResources,
  mode,
  onSelectMode,
  switchToManualPending,
  repositories,
  repositoriesLoading,
  stagedRepository,
  onStageRepository,
  onSaveRepository,
  saveRepositoryPending,
  onSync,
  syncPending,
}: {
  configuration: Configuration;
  manageResources: boolean;
  mode: "manual" | "github";
  onSelectMode: (mode: "manual" | "github") => void;
  switchToManualPending: boolean;
  repositories: ComboboxRepository[];
  repositoriesLoading: boolean;
  stagedRepository: ComboboxRepository | null;
  onStageRepository: (repository: ComboboxRepository) => void;
  onSaveRepository: () => void;
  saveRepositoryPending: boolean;
  onSync: () => void;
  syncPending: boolean;
}) {
  const currentRepository: ComboboxRepository | null =
    configuration.sourceState.kind === "github"
      ? {
          connectionId: configuration.sourceState.githubConnectionId,
          repositoryId: configuration.sourceState.githubRepositoryId,
          fullName: configuration.sourceState.githubRepositoryFullName,
          defaultBranch: configuration.sourceState.githubDefaultBranch,
        }
      : null;

  if (!manageResources) {
    return (
      <div className="grid gap-1.5">
        <RailLabel>Source</RailLabel>
        <p className="text-sm text-muted-foreground">
          {currentRepository === null ? "Manual" : `GitHub · ${currentRepository.fullName}`}
        </p>
      </div>
    );
  }

  const manualUnavailable =
    configuration.authority === "github" && configuration.activeRevision === null;

  return (
    <div className="grid gap-2">
      <RailLabel>Source</RailLabel>
      <div
        role="radiogroup"
        aria-label="Configuration source mode"
        className="inline-flex w-full gap-1 rounded-md border bg-muted p-1"
      >
        <SourceModeButton
          active={mode === "manual"}
          disabled={switchToManualPending || manualUnavailable}
          title={
            manualUnavailable ? "Sync a GitHub revision before switching to manual." : undefined
          }
          onClick={() => onSelectMode("manual")}
        >
          Manual
        </SourceModeButton>
        <SourceModeButton
          active={mode === "github"}
          disabled={switchToManualPending}
          onClick={() => onSelectMode("github")}
        >
          <ProviderGlyph provider="github" />
          GitHub
        </SourceModeButton>
      </div>
      {mode === "github" ? (
        <div className="grid gap-2">
          <RepositoryCombobox
            repositories={repositories}
            loading={repositoriesLoading}
            selected={stagedRepository ?? currentRepository}
            placeholder="Select repository…"
            disabled={saveRepositoryPending}
            onSelect={onStageRepository}
          />
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              disabled={stagedRepository === null || saveRepositoryPending}
              aria-busy={saveRepositoryPending}
              onClick={onSaveRepository}
            >
              Save
            </Button>
            {configuration.authority === "github" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={syncPending}
                aria-busy={syncPending}
                onClick={onSync}
              >
                {syncPending ? "Syncing…" : "Sync now"}
              </Button>
            ) : null}
          </div>
          {configuration.authority === "github" ? (
            <p role="status" className="text-xs text-muted-foreground">
              {configuration.lastSyncAttempt === null
                ? "No synchronization attempt yet."
                : `${syncOutcome(configuration.lastSyncAttempt.outcome)} at ${formatDate(configuration.lastSyncAttempt.createdAt)}${configuration.lastSyncAttempt.commitSha === null ? "" : ` · ${configuration.lastSyncAttempt.commitSha.slice(0, 12)}`}`}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Edited in Hub. Saving activates a new revision.
        </p>
      )}
    </div>
  );
}

function SourceModeButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string | undefined;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        active
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ManualConfigurationResult({
  result,
}: {
  result: Result<ManualConfigurationSaveResult> | undefined;
}) {
  if (result?.status !== "ok") return null;
  if (result.data.outcome === "activated") {
    return (
      <Alert role="status" className="mb-5">
        <AlertDescription>
          Configuration saved and activated as Revision {result.data.revision.version}.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive" className="mb-5">
      <AlertTitle>Configuration couldn't be activated</AlertTitle>
      <AlertDescription>
        <p>Correct the YAML and try again. The active revision was not changed.</p>
        <ul className="list-disc pl-5">
          {result.data.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  );
}

function syncOutcome(outcome: string) {
  if (outcome === "activated") return "Activated";
  if (outcome === "invalid") return "Invalid revision; active revision preserved";
  if (outcome === "superseded") return "Superseded push ignored";
  return "Fetch failed; active revision preserved";
}
