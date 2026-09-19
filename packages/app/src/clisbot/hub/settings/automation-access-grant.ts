/**
 * Granting Run or Admin on one Automation through the assignments contract
 * (`POST/DELETE access-assignments`). The Hub applies the grantor rule; the
 * only refusal this needs to word is `access_exceeds_grantor`.
 */
import type { z } from "zod";
import { HubApiError, type HubApiClient } from "../api-client";
import { HubAccessAssignmentSchema, type HubAccessAssignmentsSchema } from "../contracts";
import type { HubAutomationScope } from "./automation-access";

export type HubAccessAssignment = z.infer<typeof HubAccessAssignmentsSchema>["assignments"][number];

const PRIVILEGES_BY_SCOPE: Record<HubAutomationScope, readonly string[]> = {
  run: ["automation.run"],
  admin: ["automation.run", "hub.access.manage"],
};

export function automationAssignments(
  assignments: readonly HubAccessAssignment[] | undefined,
  automationId: string,
): HubAccessAssignment[] {
  return (assignments ?? []).filter(
    ({ resourceKind, resourceId }) => resourceKind === "automation" && resourceId === automationId,
  );
}

export function assignmentScope(
  assignment: Pick<HubAccessAssignment, "privileges">,
): HubAutomationScope {
  return assignment.privileges.includes("hub.access.manage") ? "admin" : "run";
}

export function grantAutomationAccess(
  api: HubApiClient,
  automationId: string,
  membershipId: string,
  scope: HubAutomationScope,
): Promise<HubAccessAssignment> {
  return api.post(
    "access-assignments",
    {
      subjectKind: "member",
      subjectId: membershipId,
      resourceKind: "automation",
      resourceId: automationId,
      privileges: [...PRIVILEGES_BY_SCOPE[scope]],
      constraints: {},
    },
    HubAccessAssignmentSchema,
  );
}

export function removeAutomationAccess(api: HubApiClient, assignmentId: string): Promise<void> {
  return api.delete(`access-assignments/${encodeURIComponent(assignmentId)}`);
}

export function grantErrorMessage(error: unknown): string {
  if (error instanceof HubApiError && error.code === "access_exceeds_grantor") {
    return "You can grant only what you hold on this Automation.";
  }
  return error instanceof Error ? error.message : "Hub request failed.";
}
