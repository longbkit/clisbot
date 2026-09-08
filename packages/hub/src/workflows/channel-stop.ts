import { parseCompiledHubConfig } from "../config/compiler.js";
import type { AcceptedTriggerRunRecord, Database } from "../db/types.js";

export interface ChannelWorkflowAccessTarget {
  daemonReference: string;
  projectId?: string;
}

/** Authorize the captured revision, then stop only the runs included in that decision. */
export async function stopChannelWorkflowRuns(input: {
  database: Database;
  organizationId: string;
  bindingKey: string;
  workflowName: string;
  authorizeTarget: (target: ChannelWorkflowAccessTarget) => Promise<boolean>;
  recoverExecutions: (executionIds: readonly string[]) => Promise<void>;
}): Promise<number> {
  const runs = await input.database.listActiveChannelWorkflowRuns(input);
  await authorizeChannelWorkflowRunTargets(input.database, runs, input.authorizeTarget);
  const stopped = await input.database.stopChannelWorkflowRuns({
    ...input,
    runIds: runs.map(({ id }) => id),
  });
  await input.recoverExecutions(stopped.flatMap(({ executionIds }) => executionIds));
  return stopped.length;
}

/** Shared read/control gate over each run's captured immutable configuration. */
export async function authorizeChannelWorkflowRunTargets(
  database: Database,
  runs: readonly AcceptedTriggerRunRecord[],
  authorizeTarget: (target: ChannelWorkflowAccessTarget) => Promise<boolean>,
): Promise<void> {
  for (const run of runs) {
    const targets = await runAccessTargets(database, run);
    for (const target of targets) {
      if (!(await authorizeTarget(target))) {
        throw new Error("This automation requires agent.interact for every target Project.");
      }
    }
  }
}

/** All steps are included, so a successor starting during authorization cannot widen the action. */
async function runAccessTargets(
  database: Database,
  run: AcceptedTriggerRunRecord,
): Promise<ChannelWorkflowAccessTarget[]> {
  const revision = await database.findOrganizationTriggerRevision(
    run.workflowId,
    run.configurationRevisionId,
  );
  if (!revision) throw new Error("The captured automation configuration is unavailable.");
  const configuration = parseCompiledHubConfig(revision.normalizedConfiguration);
  const workflow = configuration.triggers.find(({ name }) => name === run.configuredTriggerName);
  if (!workflow || workflow.steps.length === 0)
    throw new Error("The captured automation targets are unavailable.");
  const targets = new Map<string, ChannelWorkflowAccessTarget>();
  for (const step of workflow.steps) {
    const environment = configuration.environments.find(({ name }) => name === step.environment);
    if (environment?.kind !== "daemon" || !environment.daemonId) {
      throw new Error("The automation target Host is unavailable.");
    }
    const target = {
      daemonReference: environment.daemonId,
      ...(environment.projectId === undefined ? {} : { projectId: environment.projectId }),
    };
    targets.set(JSON.stringify(target), target);
  }
  return [...targets.values()];
}
