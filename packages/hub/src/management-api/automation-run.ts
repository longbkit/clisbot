import type { Database } from "../db/types.js";

/** Management projection: execution status and delivery counts, never prompts or output bodies. */
export async function automationRunView(
  database: Database,
  organizationId: string,
  automationId: string,
  runId: string,
) {
  const run = await database.findTriggerRunById(runId);
  if (run?.organizationId !== organizationId || run.workflowId !== automationId) return undefined;
  const steps = await database.listWorkflowStepRunsForTriggerRun(run.id);
  return {
    id: run.id,
    status: run.status,
    revisionId: run.configurationRevisionId,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    error: run.outcome === "accepted" ? run.failureReason : run.rejection.code,
    steps: await Promise.all(
      steps.map(async (step) => {
        const execution =
          step.agentExecutionId === null
            ? undefined
            : await database.findAgentExecutionForOrganization(
                organizationId,
                step.agentExecutionId,
              );
        return {
          id: step.id,
          name: step.stepId,
          status: step.status,
          startedAt: step.startedAt?.toISOString() ?? null,
          completedAt: step.completedAt?.toISOString() ?? null,
          error: step.failureReason,
          outputs: execution?.workflowId === automationId ? execution.outputEmissions : {},
        };
      }),
    ),
  };
}
