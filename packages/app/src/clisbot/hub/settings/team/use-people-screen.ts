import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import type { MemberRowHandlers } from "./member-row";
import type { OrganizationRole } from "./member-role";
import type { HubMember, HubTeam, TeamSelection } from "./types";
import { useInviteRequest } from "./use-invite-people";
import type { TeamActions } from "./use-team-actions";

/** Which Member or Team is open, and the jump from it to the Access screen with that subject. */
export function usePeopleSelection() {
  const router = useRouter();
  const [selection, setSelection] = useState<TeamSelection>();
  const back = useCallback(() => setSelection(undefined), []);
  const manageAccess = useCallback(() => {
    if (selection === undefined) return;
    // Access is People's own tab: switch to it with this Member or Team chosen.
    router.setParams({ view: "access", subjectKind: selection.kind, subjectId: selection.id });
    setSelection(undefined);
  }, [router, selection]);
  return { selection, setSelection, back, manageAccess };
}

/**
 * The Invite people modal and the row actions that open it: from the header with nothing
 * chosen, from a Team with that Team chosen, from a "No Team" row with that Member chosen.
 */
export function useInvitePeople(
  actions: TeamActions,
  setRole: (member: HubMember, role: OrganizationRole) => Promise<void>,
  select: (value: TeamSelection) => void,
) {
  const invite = useInviteRequest();
  const [notice, setNotice] = useState<string | null>(null);
  const openInvite = useCallback(() => {
    setNotice(null);
    invite.open();
  }, [invite]);
  const addPeopleToTeam = useCallback(
    (team: HubTeam) => invite.open({ teamIds: [team.id] }),
    [invite],
  );
  const handlers = useMemo<MemberRowHandlers>(
    () => ({
      select,
      setRole,
      remove: (member) => void actions.removeMember(member.id, member.name),
      addToTeam: (member) => invite.open({ members: [member] }),
    }),
    [actions, invite, select, setRole],
  );
  return { invite, notice, setNotice, openInvite, addPeopleToTeam, handlers };
}
