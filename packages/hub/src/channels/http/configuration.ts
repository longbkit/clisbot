import { createHash } from "node:crypto";
import type { Database } from "../../db/types.js";
import { compileHubBundle, HubBundleError, type HubBundleFile } from "../../config/bundle.js";
import {
  channelAgentNames,
  channelEnvironmentNames,
  assertOpenAudienceTargetSafety,
  type ChannelControlPlaneSnapshot,
} from "../control-plane.js";
import {
  ChannelCompilationError,
  compileChannelControlPlane,
  type ChannelControlPlane,
} from "../config/compile.js";
import { invalidConfiguration } from "./problems.js";

/**
 * Pre-compile the channel control plane from the candidate files, then insert
 * + activate a new revision. The pre-compile is the guard: `activate`
 * validates the hub bundle + daemon agents, but the channel compile only runs
 * at load time — a broken channel revision would poison every later load.
 */
export async function deployRevision(
  database: Database,
  snapshot: ChannelControlPlaneSnapshot,
  files: readonly HubBundleFile[],
  options: {
    createdByUserId?: string | null;
    expectedRevisionId?: string | null;
    authorize?: (candidate: ChannelConfigurationCandidate) => Promise<void>;
  } = {},
): Promise<void> {
  const candidate = await prepareChannelConfigurationCandidate(database, snapshot, files);
  await options.authorize?.(candidate);
  const canonical = [...files].sort((left, right) => left.path.localeCompare(right.path));
  await database.saveChannelConfiguration({
    organizationId: snapshot.organizationId,
    files: canonical,
    contentHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    createdByUserId: options.createdByUserId ?? null,
    ...(options.expectedRevisionId === undefined
      ? {}
      : { expectedRevisionId: options.expectedRevisionId }),
  });
}

/** Compile a complete candidate with the same rules as deployment, without writing a revision. */
export async function validateChannelConfigurationCandidate(
  database: Database,
  snapshot: ChannelControlPlaneSnapshot,
  files: readonly HubBundleFile[],
): Promise<ChannelControlPlane> {
  return (await prepareChannelConfigurationCandidate(database, snapshot, files)).controlPlane;
}

export interface ChannelConfigurationCandidate {
  bundle: ReturnType<typeof compileHubBundle>;
  controlPlane: ChannelControlPlane;
}

/** Compiles the authored bundle and effective Channel policy used by activation authorization. */
export async function prepareChannelConfigurationCandidate(
  database: Database,
  snapshot: ChannelControlPlaneSnapshot,
  files: readonly HubBundleFile[],
): Promise<ChannelConfigurationCandidate> {
  try {
    const candidateResourceFiles = [...files];
    if (!candidateResourceFiles.some(({ path }) => path === ".paseo/hub.yml")) {
      candidateResourceFiles.push({
        path: ".paseo/hub.yml",
        content: "environments: {}\nagents: {}\n",
      });
    }
    const candidateBundle = compileHubBundle(candidateResourceFiles, {
      requireWorkflow: false,
    });
    const workflowNames = (await database.listOrganizationTriggers(snapshot.organizationId))
      .filter(({ enabled }) => enabled)
      .map(({ name }) => name);
    const controlPlane = compileChannelControlPlane({
      files,
      agentNames: channelAgentNames(candidateBundle),
      environmentNames: channelEnvironmentNames(candidateBundle),
      workflowNames,
    });
    await assertOpenAudienceTargetSafety(
      database,
      snapshot.organizationId,
      candidateBundle,
      controlPlane,
    );
    return { bundle: candidateBundle, controlPlane };
  } catch (error) {
    if (error instanceof ChannelCompilationError || error instanceof HubBundleError) {
      throw invalidConfiguration(error.message);
    }
    throw error;
  }
}
