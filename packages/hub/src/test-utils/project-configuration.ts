import { randomUUID } from "node:crypto";
import { compileHubConfig, compiledConfigurationHash } from "../config/compiler.js";
import {
  ProjectConfigurationStore,
  type CompiledProjectConfiguration,
} from "../configuration/store.js";
import type { Database, ProjectConfigurationRevisionRecord, ProjectRecord } from "../db/types.js";
import type {
  OrganizationTriggerRecord,
  OrganizationTriggerRevisionRecord,
} from "../db/types.js";
import { createWorkflowConfigurationResolver } from "../triggers/configuration.js";

export const TEST_DAEMON_ID = "10000000-0000-4000-8000-000000000001";
export const TEST_DAEMON_SLUG = "daemon-10000000";

export interface ActiveProjectConfigurationFixture {
  project: ProjectRecord;
  revision: ProjectConfigurationRevisionRecord;
  store: ProjectConfigurationStore;
}

export interface ActiveWorkflowConfigurationFixture {
  workflow: OrganizationTriggerRecord;
  revision: OrganizationTriggerRevisionRecord;
  configurationForWorkflow: ReturnType<typeof createWorkflowConfigurationResolver>;
}

export async function createActiveWorkflowConfiguration(
  database: Database,
  rawConfiguration: unknown,
  options: { organizationId?: string } = {},
): Promise<ActiveWorkflowConfigurationFixture> {
  const organizationId = options.organizationId ?? "org_1";
  const configuration = compileTestDaemonReferences(rawConfiguration);
  const triggerName = configuration.triggers[0]?.name ?? `workflow-${randomUUID()}`;
  const workflow = await database.saveOrganizationTrigger({
    organizationId,
    name: triggerName,
    enabled: true,
    format: "legacy_multistep",
    yaml: `name: ${triggerName}`,
    normalizedConfiguration: configuration,
    contentHash: compiledConfigurationHash(configuration),
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    createdByUserId: null,
    routes: [],
  });
  const revision = await database.findOrganizationTriggerRevision(
    workflow.id,
    workflow.activeRevisionId,
  );
  if (revision === undefined) throw new Error("workflow revision was not persisted");
  return {
    workflow,
    revision,
    configurationForWorkflow: createWorkflowConfigurationResolver(database),
  };
}

export async function createActiveProjectConfiguration(
  database: Database,
  rawConfiguration: unknown,
  options: {
    organizationId?: string;
    projectSlug?: string;
    userId?: string;
  } = {},
): Promise<ActiveProjectConfigurationFixture> {
  const organizationId = options.organizationId ?? "org_1";
  const userId = options.userId ?? "test-user";
  const projectSlug = options.projectSlug ?? `project-${randomUUID()}`;
  const project = await database.createProject({
    organizationId,
    name: projectSlug,
    slug: projectSlug,
    createdByUserId: userId,
  });
  const configuration = compileTestDaemonReferences(rawConfiguration);
  const revision = await database.insertProjectConfigurationRevision({
    projectId: project.id,
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    normalizedConfiguration: configuration,
    contentHash: compiledConfigurationHash(configuration),
    createdByUserId: userId,
  });
  await database.activateProjectConfigurationRevision(project.id, revision.id);
  return {
    project,
    revision,
    store: new ProjectConfigurationStore(database, project.id),
  };
}

function compileTestDaemonReferences(rawConfiguration: unknown): CompiledProjectConfiguration {
  const configuration = compileHubConfig(rawConfiguration);
  return {
    ...configuration,
    environments: configuration.environments.map((environment) =>
      environment.kind === "daemon"
        ? Object.assign({}, environment, {
            daemonId:
              environment.daemon === TEST_DAEMON_SLUG
                ? TEST_DAEMON_ID
                : `daemon-${environment.daemon}`,
          })
        : environment,
    ),
  };
}

export async function enrollTestDaemon(
  database: Database,
  organizationId = "org_1",
): Promise<void> {
  const tokenVerifier = `token-verifier-${randomUUID()}`;
  await database.issueEnrollmentToken({
    id: randomUUID(),
    verifier: tokenVerifier,
    organizationId,
    expiresAt: new Date("2026-08-06T12:00:00.000Z"),
    consumedAt: null,
  });
  await database.enrollDaemon({
    tokenVerifier,
    daemonId: TEST_DAEMON_ID,
    idempotencyKey: `runner-idempotency-${organizationId}`,
    serverId: "server-1",
    daemonPublicKey: "public-key",
    credentialVerifier: "credential-verifier",
    permissions: ["hub.execute"],
    now: new Date("2026-08-06T11:00:00.000Z"),
  });
}
