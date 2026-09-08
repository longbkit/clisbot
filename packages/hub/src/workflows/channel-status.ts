import type { Database } from "../db/types.js";
import {
  authorizeChannelWorkflowRunTargets,
  type ChannelWorkflowAccessTarget,
} from "./channel-stop.js";

export interface ChannelWorkflowRunSummary {
  id: string;
  status: string;
  steps: Array<{ id: string; status: string; agentId?: string; serverId?: string }>;
}

/** Private command summaries use the execution's actual Host, including multi-host workflows. */
export async function readChannelWorkflowRuns(input: {
  database: Database;
  organizationId: string;
  bindingKey: string;
  workflowName: string;
  authorizeTarget: (target: ChannelWorkflowAccessTarget) => Promise<boolean>;
}): Promise<ChannelWorkflowRunSummary[]> {
  const runs = await input.database.listActiveChannelWorkflowRuns(input);
  await authorizeChannelWorkflowRunTargets(input.database, runs, input.authorizeTarget);
  return Promise.all(
    runs.map(async (run) => {
      const steps = await input.database.listWorkflowStepRunsForTriggerRun(run.id);
      return {
        id: run.id,
        status: run.status,
        steps: await Promise.all(
          steps.map(async (step) => {
            const execution = await input.database.findAgentExecutionByWorkflowStepRunId(step.id);
            const host = execution?.daemonId
              ? await input.database.findDaemonForOrganization(
                  input.organizationId,
                  execution.daemonId,
                )
              : undefined;
            const summary: ChannelWorkflowRunSummary["steps"][number] = {
              id: step.stepId,
              status: step.status,
            };
            if (execution?.daemonAgentId) summary.agentId = execution.daemonAgentId;
            if (host?.serverId) summary.serverId = host.serverId;
            return summary;
          }),
        ),
      };
    }),
  );
}
