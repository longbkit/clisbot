import { dump } from "js-yaml";
import { z } from "zod";
import {
  compiledConfigurationHash,
  parseCompiledHubConfig,
  type CompiledHubConfig,
  type CompiledTriggerFilter,
  type CompiledTrigger,
} from "../config/compiler.js";
import type { EnvironmentConfig } from "../config/schema.js";
import {
  compileHubBundle,
  HUB_RESOURCE_PATH,
  type CompiledHubBundle,
  type HubBundleAgentValidationTarget,
  type HubBundleFile,
} from "../config/bundle.js";
import { type PromptPartialBundleFile } from "../config/prompt-partials.js";
import type {
  ConnectionProvider,
  Database,
  ProjectConfigurationRevisionRecord,
  ProjectTriggerRoute,
} from "../db/types.js";
import {
  configurationValidationErrors,
  type ConfigurationValidationErrors,
} from "./validation-errors.js";

export interface StoredProjectConfiguration {
  revision: ProjectConfigurationRevisionRecord;
  configuration: CompiledProjectConfiguration;
}

export interface DaemonAgentConfigurationValidator {
  validateAgentConfiguration(
    daemonId: string,
    agent: import("../config/compiler.js").CompiledAgent,
  ): Promise<
    | { valid: true }
    | {
        valid: false;
        issues: readonly { path: readonly (string | number)[]; message: string }[];
      }
  >;
}

export type CompiledProjectConfiguration = Omit<CompiledHubConfig, "environments" | "triggers"> & {
  environments: readonly (
    | Exclude<EnvironmentConfig, { kind: "daemon" }>
    | (Extract<EnvironmentConfig, { kind: "daemon" }> & { daemonId: string })
  )[];
  triggers: readonly CompiledTrigger[];
};

const storedPromptPartialsSchema = z.object({
  partials: z.array(z.object({ path: z.string(), content: z.string() })),
});

const storedBundleSchema = z.object({
  bundle: z.object({
    authoredHash: z.string(),
    files: z.array(z.object({ path: z.string(), content: z.string() })),
  }),
});

export function revisionBundleFiles(
  revision: Pick<ProjectConfigurationRevisionRecord, "sourceEvidence">,
): readonly HubBundleFile[] {
  const parsed = storedBundleSchema.safeParse(revision.sourceEvidence);
  return parsed.success ? parsed.data.bundle.files : [];
}

function addBundleEvidence(sourceEvidence: unknown, bundle: CompiledHubBundle): unknown {
  const evidence = {
    authoredHash: bundle.authoredHash,
    files: bundle.files.map(({ path, content }) => ({ path, content })),
  };
  return typeof sourceEvidence === "object" && sourceEvidence !== null
    ? { ...sourceEvidence, bundle: evidence }
    : { sourceEvidence, bundle: evidence };
}

/**
 * The partial files a revision was built from, read back out of the evidence this
 * module writes. Revisions are immutable, so this is the authored source the
 * dashboard editor reopens — the compiled configuration inlines the same content.
 */
export function revisionPromptPartials(
  revision: Pick<ProjectConfigurationRevisionRecord, "sourceEvidence">,
): readonly PromptPartialBundleFile[] {
  const parsed = storedPromptPartialsSchema.safeParse(revision.sourceEvidence);
  return parsed.success ? parsed.data.partials : [];
}

export class ProjectConfigurationStore {
  constructor(
    private readonly database: Database,
    private readonly projectId: string,
    private readonly daemonAgentValidator?: DaemonAgentConfigurationValidator,
  ) {}

  async validateBundle(
    files: readonly HubBundleFile[],
  ): Promise<{ valid: true } | { valid: false; validationErrors: unknown }> {
    const project = await this.database.findProjectById(this.projectId);
    if (project === undefined) {
      return {
        valid: false,
        validationErrors: { formErrors: ["unresolved organization resources: project"] },
      };
    }
    return validateHubBundleForOrganization(
      this.database,
      project.organizationId,
      files,
      this.daemonAgentValidator,
    );
  }

  async insertManualBundleRevision(input: {
    files: readonly HubBundleFile[];
    userId: string | null;
    sourceEvidence?: unknown;
  }): Promise<ProjectConfigurationRevisionRecord> {
    const bundle = compileHubBundle(input.files);
    const prepared = await prepareCompiledRevision(
      this.database,
      this.projectId,
      bundle.configuration,
      bundle.agentValidationTargets,
      this.daemonAgentValidator,
    );
    return this.database.insertProjectConfigurationRevision({
      projectId: this.projectId,
      sourceKind: "manual",
      sourceEvidence: addBundleEvidence(
        input.sourceEvidence ?? { kind: "manual", userId: input.userId },
        bundle,
      ),
      rawYaml: bundle.files.find(({ path }) => path === HUB_RESOURCE_PATH)?.content ?? null,
      normalizedConfiguration: prepared.normalizedConfiguration,
      ...(prepared.validationErrors === undefined
        ? {}
        : { validationErrors: prepared.validationErrors }),
      contentHash: prepared.contentHash,
      createdByUserId: input.userId,
    });
  }

  async insertGitHubBundleRevision(input: {
    files: readonly HubBundleFile[];
    githubConnectionId: string;
    githubRepositoryId: number;
    githubRepositoryFullName: string;
    githubDefaultBranch: string;
    commitSha: string;
    webhookDeliveryId: string | null;
    validationErrors?: unknown;
  }): Promise<ProjectConfigurationRevisionRecord> {
    const bundle = compileHubBundle(input.files);
    const prepared =
      input.validationErrors === undefined
        ? await prepareCompiledRevision(
            this.database,
            this.projectId,
            bundle.configuration,
            bundle.agentValidationTargets,
            this.daemonAgentValidator,
          )
        : {
            normalizedConfiguration: bundle.configuration,
            contentHash: bundle.authoredHash,
            validationErrors: input.validationErrors,
          };
    return this.database.insertProjectConfigurationRevision({
      projectId: this.projectId,
      sourceKind: "github",
      sourceEvidence: addBundleEvidence(
        {
          kind: "github",
          githubConnectionId: input.githubConnectionId,
          githubRepositoryId: input.githubRepositoryId,
          githubRepositoryFullName: input.githubRepositoryFullName,
          githubDefaultBranch: input.githubDefaultBranch,
          commitSha: input.commitSha,
          path: HUB_RESOURCE_PATH,
          webhookDeliveryId: input.webhookDeliveryId,
        },
        bundle,
      ),
      rawYaml: bundle.files.find(({ path }) => path === HUB_RESOURCE_PATH)?.content ?? null,
      normalizedConfiguration: prepared.normalizedConfiguration,
      ...(prepared.validationErrors === undefined
        ? {}
        : { validationErrors: prepared.validationErrors }),
      contentHash: prepared.contentHash,
    });
  }

  async activate(revisionId: string): Promise<StoredProjectConfiguration> {
    const candidate = await this.database.findProjectConfigurationRevision(
      this.projectId,
      revisionId,
    );
    if (candidate === undefined) throw new Error("configuration revision not found");
    const configuration = parseProjectConfiguration(candidate);
    const bundleFiles = revisionBundleFiles(candidate);
    if (bundleFiles.length === 0) {
      throw new Error("configuration revision has no authored bundle");
    }
    const bundle = compileHubBundle(bundleFiles);
    const validationErrors = await validateNamedAgents(
      configuration,
      bundle.agentValidationTargets,
      this.daemonAgentValidator,
    );
    if (validationErrors !== undefined) {
      throw new ConfigurationActivationValidationError(validationErrors);
    }
    const routes = await compileTriggerRoutes(this.database, this.projectId, configuration);
    const revision = await this.database.activateProjectConfigurationRevision(
      this.projectId,
      revisionId,
      routes,
    );
    return { revision, configuration };
  }

  async rollback(): Promise<StoredProjectConfiguration> {
    const target = await this.database.findProjectConfigurationRollbackTarget(this.projectId);
    if (target === undefined) throw new Error("configuration rollback target not found");
    const configuration = parseProjectConfiguration(target);
    const routes = await compileTriggerRoutes(this.database, this.projectId, configuration);
    const revision = await this.database.rollbackProjectConfiguration(
      this.projectId,
      target.id,
      routes,
    );
    return { revision, configuration };
  }

  async getActive(): Promise<StoredProjectConfiguration | undefined> {
    const revision = await this.database.findActiveProjectConfiguration(this.projectId);
    return revision === undefined
      ? undefined
      : { revision, configuration: parseProjectConfiguration(revision) };
  }

  async getRevision(revisionId: string): Promise<StoredProjectConfiguration | undefined> {
    const revision = await this.database.findProjectConfigurationRevision(
      this.projectId,
      revisionId,
    );
    return revision === undefined
      ? undefined
      : { revision, configuration: parseProjectConfiguration(revision) };
  }

  async switchToManual(userId: string): Promise<StoredProjectConfiguration> {
    const active = await this.database.findActiveProjectConfiguration(this.projectId);
    if (active === undefined) throw new Error("active configuration not found");
    const files = revisionBundleFiles(active);
    if (files.length === 0) throw new Error("active configuration has no authored bundle");
    const bundle = compileHubBundle(files);
    const rawYaml =
      bundle.files.find(({ path }) => path === HUB_RESOURCE_PATH)?.content ??
      dump(active.normalizedConfiguration, { noRefs: true, lineWidth: -1 });
    const configuration = parseProjectConfiguration(active);
    const routes = await compileTriggerRoutes(this.database, this.projectId, configuration);
    const revision = await this.database.switchProjectConfigurationToManual({
      projectId: this.projectId,
      userId,
      rawYaml,
      normalizedConfiguration: active.normalizedConfiguration,
      contentHash: compiledConfigurationHash(configuration),
      bundle: { authoredHash: bundle.authoredHash, files: bundle.files },
      routes,
    });
    return { revision, configuration: parseProjectConfiguration(revision) };
  }
}

export async function validateHubBundleForOrganization(
  database: Database,
  organizationId: string,
  files: readonly HubBundleFile[],
  daemonAgentValidator?: DaemonAgentConfigurationValidator,
): Promise<{ valid: true } | { valid: false; validationErrors: unknown }> {
  let bundle: CompiledHubBundle;
  try {
    bundle = compileHubBundle(files);
  } catch (error) {
    return { valid: false, validationErrors: formatConfigurationError(error) };
  }
  const prepared = await prepareCompiledRevisionForOrganization(
    database,
    organizationId,
    bundle.configuration,
    bundle.agentValidationTargets,
    daemonAgentValidator,
  );
  return prepared.validationErrors === undefined
    ? { valid: true }
    : { valid: false, validationErrors: prepared.validationErrors };
}

export function parseProjectConfiguration(
  revision: ProjectConfigurationRevisionRecord,
): CompiledProjectConfiguration {
  return toProjectConfiguration(parseCompiledHubConfig(revision.normalizedConfiguration));
}

function toProjectConfiguration(configuration: CompiledHubConfig): CompiledProjectConfiguration {
  const environments = configuration.environments.map((environment) => {
    if (environment.kind !== "daemon") return environment;
    if (environment.daemonId === undefined) {
      throw new Error("active configuration contains an uncompiled daemon reference");
    }
    return { ...environment, daemonId: environment.daemonId };
  });
  return { environments, triggers: configuration.triggers };
}

async function prepareCompiledRevision(
  database: Database,
  projectId: string,
  configuration: CompiledHubConfig,
  agentValidationTargets: readonly HubBundleAgentValidationTarget[],
  daemonAgentValidator: DaemonAgentConfigurationValidator | undefined,
): Promise<Extract<PreparedRevision, { kind: "compiled" }>> {
  const project = await database.findProjectById(projectId);
  if (project === undefined) {
    return {
      kind: "compiled",
      normalizedConfiguration: configuration,
      contentHash: compiledConfigurationHash(configuration),
      validationErrors: { formErrors: ["unresolved organization resources: project"] },
    };
  }
  return prepareCompiledRevisionForOrganization(
    database,
    project.organizationId,
    configuration,
    agentValidationTargets,
    daemonAgentValidator,
  );
}

async function prepareCompiledRevisionForOrganization(
  database: Database,
  organizationId: string,
  configuration: CompiledHubConfig,
  agentValidationTargets: readonly HubBundleAgentValidationTarget[],
  daemonAgentValidator: DaemonAgentConfigurationValidator | undefined,
): Promise<Extract<PreparedRevision, { kind: "compiled" }>> {
  const compiled = await resolveCompiledConfiguration(database, organizationId, configuration);
  if (!compiled.success) {
    return {
      kind: "compiled",
      normalizedConfiguration: compiled.configuration,
      contentHash: compiledConfigurationHash(compiled.configuration),
      validationErrors: compiled.validationErrors ?? { formErrors: [], issues: compiled.issues },
    };
  }
  const validationErrors = await validateNamedAgents(
    compiled.configuration,
    agentValidationTargets,
    daemonAgentValidator,
  );
  return {
    kind: "compiled",
    normalizedConfiguration: compiled.configuration,
    contentHash: compiledConfigurationHash(compiled.configuration),
    ...(validationErrors === undefined ? {} : { validationErrors }),
  };
}

export class ConfigurationActivationValidationError extends Error {
  constructor(readonly validationErrors: ConfigurationValidationErrors) {
    super("configuration is not valid for the selected daemon");
    this.name = "ConfigurationActivationValidationError";
  }
}

async function validateNamedAgents(
  configuration: CompiledProjectConfiguration,
  targets: readonly HubBundleAgentValidationTarget[],
  validator: DaemonAgentConfigurationValidator | undefined,
): Promise<ConfigurationValidationErrors | undefined> {
  if (targets.length === 0) return undefined;
  const daemonIdByEnvironment = new Map(
    configuration.environments.flatMap((environment) =>
      environment.kind === "daemon" ? [[environment.name, environment.daemonId] as const] : [],
    ),
  );
  if (validator === undefined) {
    return {
      formErrors: [],
      issues: [
        {
          path: [HUB_RESOURCE_PATH, "agents"],
          message: "the selected daemon provider-validation capability is unavailable",
        },
      ],
    };
  }
  const validations: Array<Promise<readonly { path: (string | number)[]; message: string }[]>> = [];
  for (const { name, agent, environmentNames } of targets) {
    for (const environmentName of environmentNames) {
      const daemonId = daemonIdByEnvironment.get(environmentName);
      if (daemonId === undefined) continue;
      validations.push(
        validator.validateAgentConfiguration(daemonId, agent).then(
          (result) =>
            result.valid
              ? []
              : result.issues.map((entry) => ({
                  path: [HUB_RESOURCE_PATH, "agents", name, ...entry.path],
                  message: entry.message,
                })),
          (error: unknown) => [
            {
              path: [HUB_RESOURCE_PATH, "agents", name],
              message:
                error instanceof Error
                  ? `selected daemon could not validate this agent: ${error.message}`
                  : "selected daemon could not validate this agent",
            },
          ],
        ),
      );
    }
  }
  const issues = (await Promise.all(validations)).flat();
  return issues.length === 0 ? undefined : { formErrors: [], issues };
}

interface PreparedRevision {
  kind: "compiled";
  normalizedConfiguration: CompiledHubConfig;
  contentHash: string;
  validationErrors?: unknown;
}

type CompileConfigurationResult =
  | { success: true; configuration: CompiledProjectConfiguration }
  | {
      success: false;
      kind: "compiled";
      configuration: CompiledHubConfig;
      issues: readonly { path: readonly (string | number)[]; message: string }[];
      validationErrors?: unknown;
    };

async function resolveCompiledConfiguration(
  database: Database,
  organizationId: string,
  configuration: CompiledHubConfig,
): Promise<CompileConfigurationResult> {
  const daemons = (await database.listDaemonsForOrganization(organizationId)).filter(
    ({ status }) => status === "active",
  );
  const resolutions = await Promise.all(
    configuration.environments.map(async (environment) =>
      environment.kind === "daemon"
        ? {
            environment,
            daemon: await database.findDaemonBySlugForOrganization(
              organizationId,
              environment.daemon,
            ),
          }
        : { environment, daemon: undefined },
    ),
  );
  const daemonIssues = resolutions.flatMap(({ environment, daemon }) =>
    environment.kind === "daemon" && daemon === undefined
      ? [
          {
            path: [HUB_RESOURCE_PATH, "environments", environment.name, "daemon"],
            message: `"${environment.daemon}" does not match any daemon (${formatCandidates(
              daemons.map(({ slug }) => slug),
            )})`,
          },
        ]
      : [],
  );
  const triggerCompilation = await compileTriggers(
    database,
    organizationId,
    configuration.triggers,
  );
  const issues = [...daemonIssues, ...triggerCompilation.issues];
  if (issues.length > 0) {
    return { success: false, kind: "compiled", issues, configuration };
  }
  const resolvedConfiguration: CompiledHubConfig = {
    ...configuration,
    environments: resolutions.map(resolveEnvironment),
    triggers: triggerCompilation.triggers,
  };
  return {
    success: true,
    configuration: toProjectConfiguration(parseCompiledHubConfig(resolvedConfiguration)),
  };
}

function formatConfigurationError(error: unknown): ConfigurationValidationErrors {
  if (error instanceof z.ZodError) return configurationValidationErrors(error);
  return {
    formErrors: [error instanceof Error ? error.message : "invalid configuration"],
    fieldErrors: {},
  };
}

function resolveEnvironment(
  resolution: EnvironmentResolution,
): CompiledHubConfig["environments"][number] {
  const { environment, daemon } = resolution;
  if (environment.kind !== "daemon" || daemon === undefined) return environment;
  return Object.assign({}, environment, { daemonId: daemon.id });
}

interface EnvironmentResolution {
  environment: CompiledHubConfig["environments"][number];
  daemon: { id: string } | undefined;
}

async function compileTriggerRoutes(
  database: Database,
  projectId: string,
  configuration: CompiledProjectConfiguration,
): Promise<ProjectTriggerRoute[]> {
  const project = await database.findProjectById(projectId);
  if (project === undefined) throw new Error("project not found");
  const routes = await compileTriggers(database, project.organizationId, configuration.triggers);
  if (routes.issues.length > 0)
    throw new Error(routes.issues.map(({ message }) => message).join("; "));
  return routes.routes;
}

async function compileTriggers(
  database: Database,
  organizationId: string,
  triggers: readonly CompiledTrigger[],
): Promise<{
  triggers: CompiledTrigger[];
  routes: ProjectTriggerRoute[];
  issues: readonly { path: readonly (string | number)[]; message: string }[];
}> {
  const usage = await database.organizationConnectionUsage(organizationId);
  const compiled: CompiledTrigger[] = [];
  const routes: ProjectTriggerRoute[] = [];
  const issues: { path: readonly (string | number)[]; message: string }[] = [];

  for (const trigger of triggers) {
    const provider = providerForEvent(trigger.on);
    if (provider === undefined) {
      compiled.push(trigger);
      continue;
    }
    const filter = trigger.filters;
    if (filter?.connectionId !== undefined && filter.resourceId !== undefined) {
      compiled.push(trigger);
      routes.push({
        provider,
        connectionId: filter.connectionId,
        resourceId: filter.resourceId,
        triggerName: trigger.name,
      });
      continue;
    }
    const authored = readAuthoredResource(provider, filter);
    const candidates = connectionCandidates(provider, usage, filter);
    const authoredConnection = filter?.connection;
    if (typeof authoredConnection === "string" && candidates.length === 0) {
      issues.push({
        path: triggerFilterPath(trigger, "connection"),
        message: `"${authoredConnection}" does not match any ${providerLabel(provider)} connection (${formatConnectionCandidates(provider, usage[provider])})`,
      });
      continue;
    }
    if (authored !== undefined) {
      const resolved = await resolveResource(
        database,
        organizationId,
        provider,
        authored,
        new Set(candidates.map((connection) => connection.id)),
      );
      if (resolved === undefined) {
        issues.push({
          path: triggerFilterPath(trigger, resourceField(provider)),
          message: `"${authored}" does not match any ${resourceLabel(provider)} (${await formatResourceCandidates(
            database,
            organizationId,
            provider,
            candidates,
          )})`,
        });
        continue;
      }
      const resolvedFilter =
        provider === "github"
          ? filter
          : { ...filter, [resourceField(provider)]: resolved.resourceId };
      const nextFilter: CompiledTriggerFilter = {
        ...resolvedFilter,
        connectionId: resolved.connectionId,
        resourceId: resolved.resourceId,
      };
      compiled.push({ ...trigger, filters: nextFilter });
      routes.push({
        provider,
        connectionId: resolved.connectionId,
        resourceId: resolved.resourceId,
        triggerName: trigger.name,
      });
      continue;
    }

    const nextFilter: CompiledTriggerFilter | undefined =
      typeof authoredConnection === "string" && filter !== undefined
        ? { ...filter, connectionId: candidates[0]!.id }
        : filter;
    compiled.push({ ...trigger, ...(nextFilter === undefined ? {} : { filters: nextFilter }) });
    for (const connection of candidates) {
      routes.push({
        provider,
        connectionId: connection.id,
        resourceId: null,
        triggerName: trigger.name,
      });
    }
  }
  return { triggers: compiled, routes, issues };
}

function providerForEvent(eventName: string): ConnectionProvider | undefined {
  const provider = eventName.slice(0, eventName.indexOf("."));
  return provider === "github" || provider === "slack" || provider === "discord"
    ? provider
    : undefined;
}

function readAuthoredResource(
  provider: ConnectionProvider,
  filters: CompiledTrigger["filters"] | undefined,
): string | undefined {
  if (filters === undefined) return undefined;
  let value: string | undefined;
  if (provider === "github") value = filters.repo;
  else if (provider === "slack") value = filters.workspace;
  else value = filters.guild;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function connectionCandidates(
  provider: ConnectionProvider,
  usage: Awaited<ReturnType<Database["organizationConnectionUsage"]>>,
  filters: CompiledTrigger["filters"] | undefined,
) {
  const connections = usage[provider];
  const authoredSlug = filters?.["connection"];
  if (typeof authoredSlug !== "string") return connections;
  return connections.filter((connection) => connection.slug === authoredSlug);
}

async function resolveResource(
  database: Database,
  organizationId: string,
  provider: ConnectionProvider,
  resource: string,
  allowedConnectionIds: ReadonlySet<string>,
): Promise<{ connectionId: string; resourceId: string } | undefined> {
  if (provider === "github") {
    const repositories = (await database.listGitHubRepositories(organizationId)).filter(
      (repository) =>
        repository.fullName === resource && allowedConnectionIds.has(repository.connectionId),
    );
    if (repositories.length !== 1) return undefined;
    const repository = repositories[0]!;
    return { connectionId: repository.connectionId, resourceId: String(repository.repositoryId) };
  }
  if (provider === "slack") {
    const connection = (await database.organizationConnectionUsage(organizationId)).slack.find(
      ({ id, slug }) => slug === resource && allowedConnectionIds.has(id),
    );
    return connection === undefined
      ? undefined
      : { connectionId: connection.id, resourceId: connection.teamId };
  }
  const connection = (await database.organizationConnectionUsage(organizationId)).discord.find(
    ({ id, slug }) => slug === resource && allowedConnectionIds.has(id),
  );
  return connection === undefined
    ? undefined
    : { connectionId: connection.id, resourceId: connection.guildId };
}

function triggerFilterPath(trigger: CompiledTrigger, field: string): readonly (string | number)[] {
  return [trigger.sourceFile ?? ".paseo/workflows", "filters", field];
}

function resourceField(provider: ConnectionProvider): "repo" | "workspace" | "guild" {
  if (provider === "github") return "repo";
  return provider === "slack" ? "workspace" : "guild";
}

function providerLabel(provider: ConnectionProvider): string {
  if (provider === "github") return "GitHub";
  return provider === "slack" ? "Slack" : "Discord";
}

function resourceLabel(provider: ConnectionProvider): string {
  return provider === "github" ? "GitHub repository" : `${providerLabel(provider)} connection`;
}

function formatCandidates(candidates: readonly string[]): string {
  return candidates.length === 0 ? "connected: none" : `connected: ${candidates.join(", ")}`;
}

function formatConnectionCandidates(
  provider: ConnectionProvider,
  connections: readonly {
    id: string;
    slug: string;
    guildName?: string;
    teamName?: string;
  }[],
): string {
  return formatCandidates(
    connections.map((connection) => {
      if (provider === "discord" && connection.guildName !== undefined)
        return `${connection.slug} "${connection.guildName}"`;
      if (provider === "slack" && connection.teamName !== undefined)
        return `${connection.slug} "${connection.teamName}"`;
      return connection.slug;
    }),
  );
}

async function formatResourceCandidates(
  database: Database,
  organizationId: string,
  provider: ConnectionProvider,
  connections: readonly { id: string; slug: string; guildName?: string; teamName?: string }[],
): Promise<string> {
  if (provider !== "github") return formatConnectionCandidates(provider, connections);
  const connectionIds = new Set(connections.map(({ id }) => id));
  return formatCandidates(
    (await database.listGitHubRepositories(organizationId))
      .filter(({ connectionId }) => connectionIds.has(connectionId))
      .map(({ fullName }) => fullName),
  );
}
