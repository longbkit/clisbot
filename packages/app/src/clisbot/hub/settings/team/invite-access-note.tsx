import { useCallback } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { subjectAssignments } from "../access-summary";
import { teamAccessLine } from "./team-directory";
import type { TeamResources } from "./types";

/** Whether the chosen Teams' access can be shown; nobody is added to a Team whose grants are unknown. */
export function teamAccessReady(resources: TeamResources, teamIds: readonly string[]): boolean {
  if (teamIds.length === 0 || !resources.canManageResources) return true;
  return resources.assignments.data !== undefined && !resources.assignments.isError;
}

/** What the chosen Teams grant, in one line, or a retry when that cannot be read. */
export function InviteAccessNote({
  resources,
  teamIds,
}: {
  resources: TeamResources;
  teamIds: readonly string[];
}) {
  const { assignments } = resources;
  const retry = useCallback(() => void assignments.refetch(), [assignments]);
  if (teamIds.length === 0 || !resources.canManageResources) return null;
  if (assignments.isError || (assignments.data === undefined && !assignments.isPending)) {
    return (
      <Alert
        variant="error"
        title="Team access unavailable"
        description="Refresh the Teams' access before adding people."
      >
        <Button size="sm" variant="outline" onPress={retry}>
          Retry
        </Button>
      </Alert>
    );
  }
  if (assignments.data === undefined) return null;
  const granted = teamIds.flatMap((teamId) =>
    subjectAssignments(assignments.data.assignments, "team", teamId),
  );
  return (
    <Alert
      variant="info"
      title="Everyone receives the chosen Teams' access"
      description={teamAccessLine(granted)}
    />
  );
}
