import { parseCompiledHubConfig } from "../config/compiler.js";
import {
  toExecutionConfiguration,
  type CompiledExecutionConfiguration,
} from "../configuration/store.js";
import type { Database, OrganizationTriggerRevisionRecord } from "../db/types.js";
import type { ExternalTrigger } from "./index.js";

export interface StoredWorkflowConfiguration {
  revision: OrganizationTriggerRevisionRecord;
  configuration: CompiledExecutionConfiguration;
}

export type WorkflowConfigurationResolver = (
  trigger: ExternalTrigger,
) => Promise<StoredWorkflowConfiguration | undefined>;

export function createWorkflowConfigurationResolver(
  database: Pick<Database, "findOrganizationTriggerRevision">,
): WorkflowConfigurationResolver {
  return async (trigger) => {
    const revision = await database.findOrganizationTriggerRevision(
      trigger.workflowId,
      trigger.configurationRevisionId,
    );
    if (revision === undefined || revision.organizationId !== trigger.organizationId) {
      return undefined;
    }
    return {
      revision,
      configuration: toExecutionConfiguration(
        parseCompiledHubConfig(revision.normalizedConfiguration),
      ),
    };
  };
}
