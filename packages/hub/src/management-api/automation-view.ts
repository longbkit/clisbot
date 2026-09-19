/**
 * Response shapes for the Automations management contract. `author` and
 * `target` exist so the app can word the Run warning ("Runs with <author>'s
 * access on <project>") without a second request per row.
 */
import { inArray } from "drizzle-orm";
import { load } from "js-yaml";
import type { AccessStore } from "../access/store.js";
import { parseCompiledHubConfig } from "../config/compiler.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import type {
  Database,
  OrganizationTriggerRecord,
  OrganizationTriggerRevisionRecord,
} from "../db/types.js";
import { editableAutomationYaml } from "../triggers/configuration/workflow-document.js";
import type { OrganizationTriggerStore } from "../triggers/store.js";

/** What the viewer may do with one Automation: manage it, or only run it. */
export type AutomationScope = "admin" | "run";

export interface AutomationTarget {
  daemonName: string | null;
  projectName: string | null;
}

/**
 * Per-request lookups the views share. Host names and Project names are
 * fetched once per Host, author names once per response.
 */
export class AutomationViewContext {
  private daemons: Promise<Map<string, string>> | undefined;
  private readonly projects = new Map<string, Promise<Map<string, string>>>();

  constructor(
    private readonly deps: { database: Database; runtime: DatabaseRuntime; access: AccessStore },
    private readonly organizationId: string,
  ) {}

  async target(revision: OrganizationTriggerRevisionRecord): Promise<AutomationTarget> {
    const environment = parseCompiledHubConfig(revision.normalizedConfiguration).environments.find(
      (candidate) => candidate.kind === "daemon",
    );
    if (environment === undefined || environment.kind !== "daemon") {
      return { daemonName: null, projectName: null };
    }
    const daemons = await this.daemonNames();
    const daemonId =
      environment.daemonId ??
      [...daemons.entries()].find(([, slug]) => slug === environment.daemon)?.[0];
    const daemonName = daemonId === undefined ? null : (daemons.get(daemonId) ?? null);
    if (daemonId === undefined || environment.projectId === undefined) {
      return { daemonName, projectName: null };
    }
    const projects = await this.projectNames(daemonId);
    return { daemonName, projectName: projects.get(environment.projectId) ?? null };
  }

  async authors(userIds: readonly (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const rows = await this.deps.runtime
      .drizzle()
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, ids));
    return new Map(rows.map(({ id, name }) => [id, name]));
  }

  private daemonNames(): Promise<Map<string, string>> {
    this.daemons ??= this.deps.database
      .listDaemonsForOrganization(this.organizationId)
      .then((daemons) => new Map(daemons.map(({ id, slug }) => [id, slug])));
    return this.daemons;
  }

  private projectNames(daemonId: string): Promise<Map<string, string>> {
    let names = this.projects.get(daemonId);
    if (names === undefined) {
      names = this.deps.access
        .listDaemonProjects(this.organizationId, daemonId)
        .then((projects) => new Map(projects.map(({ projectId, name }) => [projectId, name])));
      this.projects.set(daemonId, names);
    }
    return names;
  }
}

export async function automationView(
  context: AutomationViewContext,
  store: OrganizationTriggerStore,
  automation: OrganizationTriggerRecord,
  scope: AutomationScope,
) {
  const revision = await store.activeRevision(automation);
  const [target, authors] = await Promise.all([
    context.target(revision),
    context.authors([revision.createdByUserId]),
  ]);
  const yaml = editableAutomationYaml(revision.yaml, automation.enabled);
  return {
    id: automation.id,
    name: automation.name,
    enabled: automation.enabled,
    pausedReason: automation.pausedReason,
    scope,
    author:
      revision.createdByUserId === null
        ? null
        : {
            userId: revision.createdByUserId,
            name: authors.get(revision.createdByUserId) ?? revision.createdByUserId,
          },
    target,
    format: automation.format,
    activeRevisionId: automation.activeRevisionId,
    definition: load(yaml),
    yaml,
    createdAt: automation.createdAt.toISOString(),
    updatedAt: automation.updatedAt.toISOString(),
  };
}

export function runnableAutomationView(
  revision: OrganizationTriggerRevisionRecord,
  automation: OrganizationTriggerRecord,
) {
  const manual = parseCompiledHubConfig(revision.normalizedConfiguration).triggers.find(
    ({ on }) => on === "manual.run",
  );
  if (manual === undefined) return null;
  const definition: unknown = load(revision.yaml);
  let description: string | null = null;
  if (typeof definition === "object" && definition !== null && !Array.isArray(definition)) {
    const candidate: unknown = Reflect.get(definition, "description");
    if (typeof candidate === "string") description = candidate;
  }
  return {
    id: automation.id,
    name: automation.name,
    description,
    inputs: manual.inputs,
  };
}

export function automationRevisionView(revision: OrganizationTriggerRevisionRecord) {
  return {
    id: revision.id,
    version: revision.version,
    yaml: revision.yaml,
    definition: load(revision.yaml),
    contentHash: revision.contentHash,
    sourceKind: revision.sourceKind,
    createdByUserId: revision.createdByUserId,
    createdAt: revision.createdAt.toISOString(),
  };
}

export function automationActivityView(
  activity: Awaited<ReturnType<Database["listWorkflowActivityRuns"]>>,
) {
  return activity.map(({ run, receipt }) => ({
    id: run.id,
    outcome: run.outcome,
    status: run.status,
    revisionId: run.configurationRevisionId,
    provider: receipt.provider,
    source: receipt.source,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    error: run.outcome === "accepted" ? run.failureReason : run.rejection.code,
  }));
}
