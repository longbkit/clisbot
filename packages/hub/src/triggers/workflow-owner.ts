import type { SessionActor } from "@clisbot/protocol/session-authorship";
import type { Database } from "../db/types.js";
import { normalizeHubOrigin } from "../managed-access/hub-origin.js";
import type {
  AutomationAuthorAccessCheckDependencies,
  WorkflowRunAuthorizationInput,
} from "./author-access.js";

export type ResolveWorkflowOwner = (
  input: WorkflowRunAuthorizationInput,
) => Promise<SessionActor | undefined>;

/** Attribution from a pinned revision and a verified Member; never a new access grant. */
export function createWorkflowOwnerResolver(deps: {
  database: Pick<Database, "findOrganizationTriggerRevision">;
  resolveAuthor: AutomationAuthorAccessCheckDependencies["resolveAuthor"];
  hubOrigin: string;
}): ResolveWorkflowOwner {
  const hubOrigin = normalizeHubOrigin(deps.hubOrigin);
  return async (input) => {
    const revision = await deps.database.findOrganizationTriggerRevision(
      input.workflowId,
      input.configurationRevisionId,
    );
    if (!revision || revision.organizationId !== input.organizationId || !revision.createdByUserId)
      return undefined;
    const member = await deps.resolveAuthor(input.organizationId, revision.createdByUserId);
    if (
      !member ||
      member.organizationId !== input.organizationId ||
      member.userId !== revision.createdByUserId
    )
      return undefined;
    return {
      kind: "user",
      id: member.userId,
      memberId: member.membershipId,
      organizationId: input.organizationId,
      hubOrigin,
    };
  };
}
