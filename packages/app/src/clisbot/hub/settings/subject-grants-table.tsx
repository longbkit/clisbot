// One Team's or one Member's grants, read-only, in the same table as People & access ›
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
import { grantRows, grantedAccessLabel, subjectGrantRows } from "./access-grant-rows";
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
  const rows = useMemo(() => {
    const all = grantRows({
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
    return subjectGrantRows(all, subject, { members, teams, resources });
  }, [accessLevels, assignments, members, resources, subjectId, subjectKind, teams]);
  return <AccessGrantsTable rows={rows} grouping="subject" empty={empty} />;
}
