// One Team's or one Member's grants, read-only, in the same table as People ›
// Access: a Member's list also shows what their Teams give them.

import { useMemo } from "react";
import {
  memberNamesByUserId,
  type AccessAssignment,
  type AccessCatalog,
  type AccessResource,
  type HubMember,
  type HubTeam,
  type SubjectKind,
} from "./access-catalog";
import { grantRows, grantedAccessLabel, subjectGrantGroups } from "./access-grant-rows";
import { AccessGrantsTable } from "./access-grants-table";
import { sharesAccess } from "./access-level-summary";

export function SubjectGrantsTable({
  subjectKind,
  subjectId,
  assignments,
  resources,
  accessLevels,
  members,
  teams,
  empty,
}: {
  subjectKind: SubjectKind;
  subjectId: string;
  assignments: readonly AccessAssignment[];
  resources: readonly AccessResource[];
  accessLevels: AccessCatalog["accessLevels"];
  members: readonly HubMember[];
  teams: readonly HubTeam[];
  empty: string;
}) {
  const groups = useMemo(() => {
    const rows = grantRows({
      assignments,
      resources,
      members,
      teams,
      memberNameByUserId: memberNamesByUserId(members),
      levelLabel: (assignment) => grantedAccessLabel(assignment, accessLevels),
      sharesAccess: (assignment) => sharesAccess(assignment.resourceKind, assignment.privileges),
      locked: () => false,
    });
    const subject = { kind: subjectKind, id: subjectId };
    return subjectGrantGroups(rows, subject, { members, teams, resources });
  }, [accessLevels, assignments, members, resources, subjectId, subjectKind, teams]);
  return (
    <AccessGrantsTable groups={groups} grouping="subject" groupHeaders={false} empty={empty} />
  );
}
