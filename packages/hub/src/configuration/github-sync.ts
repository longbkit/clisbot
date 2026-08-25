import {
  compileHubBundle,
  HUB_RESOURCE_PATH,
  HubBundleError,
  type HubBundleFile,
} from "../config/bundle.js";
import { compareBundlePaths } from "../config/bundle-contract.js";
import { rawConfigurationHash } from "../config/compiler.js";
import type { PromptPartialReadResult } from "../config/prompt-partials.js";
import type { Database, ProjectConfigurationRevisionRecord } from "../db/types.js";
import { reportFailure } from "../failures/index.js";
import { ConfigurationActivationValidationError, ProjectConfigurationStore } from "./store.js";

export interface GitHubConfigurationProvider {
  listInstallationRepositories(input: {
    installationId: number;
  }): Promise<Array<{ repositoryId: number; fullName: string; defaultBranch: string }>>;
  readDefaultBranchHead(input: {
    installationId: number;
    repositoryId: number;
    defaultBranch: string;
  }): Promise<string>;
  listFilesAtCommit(input: {
    installationId: number;
    repositoryId: number;
    commitSha: string;
    prefix: string;
  }): Promise<readonly { path: string; kind: PromptPartialReadResult["kind"] }[]>;
  readFileAtCommit(input: {
    installationId: number;
    repositoryId: number;
    commitSha: string;
    path: string;
  }): Promise<PromptPartialReadResult | undefined>;
}

export type GitHubConfigurationSyncResult =
  | { outcome: "activated"; revision: ProjectConfigurationRevisionRecord }
  | { outcome: "invalid"; revision: ProjectConfigurationRevisionRecord }
  | { outcome: "fetch_failed" }
  | { outcome: "superseded" };

export async function synchronizeGitHubProjectConfiguration(input: {
  database: Database;
  client: Pick<GitHubConfigurationProvider, "listFilesAtCommit" | "readFileAtCommit">;
  projectId: string;
  githubConnectionId: string;
  githubRepositoryId: number;
  githubRepositoryFullName: string;
  githubDefaultBranch: string;
  installationId: number;
  repositoryId: number;
  commitSha: string;
  webhookDeliveryId: string | null;
  configurationForProject?: (projectId: string) => ProjectConfigurationStore;
}): Promise<GitHubConfigurationSyncResult> {
  let listed: readonly { path: string; kind: PromptPartialReadResult["kind"] }[];
  try {
    listed = await input.client.listFilesAtCommit({
      installationId: input.installationId,
      repositoryId: input.repositoryId,
      commitSha: input.commitSha,
      prefix: ".paseo",
    });
  } catch (error) {
    reportConfigurationSyncFailure(error, "bundle-list", input.projectId);
    await recordAttempt(input, "fetch_failed", {
      stage: "bundle-list",
      reason: "provider_request_failed",
    });
    return { outcome: "fetch_failed" };
  }
  if (!listed.some(({ path }) => path === HUB_RESOURCE_PATH)) {
    await recordAttempt(input, "fetch_failed", { reason: "hub_resource_not_found_at_commit" });
    return { outcome: "fetch_failed" };
  }
  const invalidEntry = listed.find(({ kind }) => kind !== "file");
  if (invalidEntry !== undefined) {
    const revision = await recordInvalidBundle(
      input,
      [],
      [
        {
          path: [invalidEntry.path],
          message: `configuration bundle entry is not a regular file (${invalidEntry.kind})`,
        },
      ],
    );
    await recordAttempt(input, "invalid", { revisionId: revision.id, stage: "bundle-kind" });
    return { outcome: "invalid", revision };
  }
  const files: HubBundleFile[] = [];
  try {
    for (const entry of listed.toSorted(compareBundlePaths)) {
      const read = await input.client.readFileAtCommit({
        installationId: input.installationId,
        repositoryId: input.repositoryId,
        commitSha: input.commitSha,
        path: entry.path,
      });
      if (read === undefined || read.kind !== "file") {
        throw new Error(`file changed or disappeared at exact commit: ${entry.path}`);
      }
      files.push({ path: entry.path, content: read.content });
    }
  } catch (error) {
    reportConfigurationSyncFailure(error, "bundle-read", input.projectId);
    await recordAttempt(input, "fetch_failed", {
      stage: "bundle-read",
      reason: "provider_request_failed",
    });
    return { outcome: "fetch_failed" };
  }
  try {
    compileHubBundle(files);
  } catch (error) {
    if (!(error instanceof HubBundleError)) throw error;
    const revision = await recordInvalidBundle(input, files, error.issues);
    await recordAttempt(input, "invalid", { revisionId: revision.id, stage: "bundle" });
    return { outcome: "invalid", revision };
  }
  const store =
    input.configurationForProject?.(input.projectId) ??
    new ProjectConfigurationStore(input.database, input.projectId);
  const revision = await store.insertGitHubBundleRevision({
    files,
    githubConnectionId: input.githubConnectionId,
    githubRepositoryId: input.repositoryId,
    githubRepositoryFullName: input.githubRepositoryFullName,
    githubDefaultBranch: input.githubDefaultBranch,
    commitSha: input.commitSha,
    webhookDeliveryId: input.webhookDeliveryId,
  });
  if (revision.validationErrors !== null) {
    await recordAttempt(input, "invalid", { revisionId: revision.id, stage: "validation" });
    return { outcome: "invalid", revision };
  }
  let activated: Awaited<ReturnType<typeof store.activate>>;
  try {
    activated = await store.activate(revision.id);
  } catch (error) {
    if (!(error instanceof ConfigurationActivationValidationError)) throw error;
    await recordAttempt(input, "invalid", { revisionId: revision.id, stage: "validation" });
    return { outcome: "invalid", revision };
  }
  await recordAttempt(input, "activated", { revisionId: activated.revision.id });
  return { outcome: "activated", revision: activated.revision };
}

export async function synchronizeGitHubDefaultBranch(input: {
  database: Database;
  client: GitHubConfigurationProvider;
  projectId: string;
  repositoryId?: number;
  expectedCommitSha?: string;
  webhookDeliveryId: string | null;
  configurationForProject?: (projectId: string) => ProjectConfigurationStore;
}): Promise<GitHubConfigurationSyncResult | undefined> {
  const target = await input.database.findGitHubConfigurationTarget(
    input.projectId,
    input.repositoryId,
  );
  if (target === undefined || !target.automaticDeploymentEnabled) return undefined;
  let branchHead: string;
  try {
    branchHead = await input.client.readDefaultBranchHead({
      installationId: target.installationId,
      repositoryId: target.repositoryId,
      defaultBranch: target.defaultBranch,
    });
  } catch (error) {
    reportConfigurationSyncFailure(error, "default-branch-head", input.projectId);
    await input.database.recordConfigurationSyncAttempt({
      projectId: input.projectId,
      githubConnectionId: target.connectionId,
      githubRepositoryId: target.repositoryId,
      webhookDeliveryId: input.webhookDeliveryId,
      commitSha: input.expectedCommitSha ?? "unknown",
      outcome: "fetch_failed",
      evidence: { stage: "default_branch_head", reason: "provider_request_failed" },
    });
    return { outcome: "fetch_failed" };
  }
  if (input.expectedCommitSha !== undefined && branchHead !== input.expectedCommitSha) {
    await input.database.recordConfigurationSyncAttempt({
      projectId: input.projectId,
      githubConnectionId: target.connectionId,
      githubRepositoryId: target.repositoryId,
      webhookDeliveryId: input.webhookDeliveryId,
      commitSha: input.expectedCommitSha,
      outcome: "superseded",
      evidence: { branchHead },
    });
    return { outcome: "superseded" };
  }
  return synchronizeGitHubProjectConfiguration({
    database: input.database,
    client: input.client,
    projectId: input.projectId,
    githubConnectionId: target.connectionId,
    githubRepositoryId: target.repositoryId,
    githubRepositoryFullName: target.fullName,
    githubDefaultBranch: target.defaultBranch,
    installationId: target.installationId,
    repositoryId: target.repositoryId,
    commitSha: branchHead,
    webhookDeliveryId: input.webhookDeliveryId,
    ...(input.configurationForProject === undefined
      ? {}
      : { configurationForProject: input.configurationForProject }),
  });
}

async function recordInvalidBundle(
  input: Parameters<typeof synchronizeGitHubProjectConfiguration>[0],
  files: readonly HubBundleFile[],
  issues: readonly { path: readonly (string | number)[]; message: string }[],
) {
  return input.database.insertProjectConfigurationRevision({
    projectId: input.projectId,
    sourceKind: "github",
    sourceEvidence: {
      kind: "github",
      githubConnectionId: input.githubConnectionId,
      githubRepositoryId: input.repositoryId,
      githubRepositoryFullName: input.githubRepositoryFullName,
      githubDefaultBranch: input.githubDefaultBranch,
      commitSha: input.commitSha,
      path: HUB_RESOURCE_PATH,
      webhookDeliveryId: input.webhookDeliveryId,
      bundle: { files, authoredHash: rawConfigurationHash(files) },
    },
    rawYaml: files.find(({ path }) => path === HUB_RESOURCE_PATH)?.content ?? null,
    normalizedConfiguration: null,
    validationErrors: {
      formErrors: issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    },
    contentHash: rawConfigurationHash(files),
  });
}

async function recordAttempt(
  input: {
    database: Database;
    projectId: string;
    githubConnectionId: string;
    repositoryId: number;
    commitSha: string;
    webhookDeliveryId: string | null;
  },
  outcome: "activated" | "invalid" | "fetch_failed",
  evidence: unknown,
) {
  return input.database.recordConfigurationSyncAttempt({
    projectId: input.projectId,
    githubConnectionId: input.githubConnectionId,
    githubRepositoryId: input.repositoryId,
    webhookDeliveryId: input.webhookDeliveryId,
    commitSha: input.commitSha,
    outcome,
    evidence,
  });
}

function reportConfigurationSyncFailure(error: unknown, stage: string, projectId: string): void {
  reportFailure(error, {
    operation: `github.configuration.${stage}`,
    component: "configuration",
    provider: "github",
    projectId,
  });
}
