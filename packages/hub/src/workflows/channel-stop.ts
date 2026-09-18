import type { Database } from "../db/types.js";

/**
 * Stop this conversation's active runs of one Automation. The channel plane has
 * already admitted the sender to the Route, and a Route's runs are the
 * conversation's own, so there is no per-Project check here.
 */
export async function stopChannelWorkflowRuns(input: {
  database: Database;
  organizationId: string;
  bindingKey: string;
  workflowName: string;
  recoverExecutions: (executionIds: readonly string[]) => Promise<void>;
}): Promise<number> {
  const runs = await input.database.listActiveChannelWorkflowRuns(input);
  const stopped = await input.database.stopChannelWorkflowRuns({
    ...input,
    runIds: runs.map(({ id }) => id),
  });
  await input.recoverExecutions(stopped.flatMap(({ executionIds }) => executionIds));
  return stopped.length;
}
