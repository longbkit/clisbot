import { useCallback, useMemo, useState } from "react";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { HubApiError } from "../../api-client";
import {
  HubAccessAssignmentSchema,
  HubChannelIdentitySchema,
  invitationTeams,
} from "../../contracts";
import {
  roleChangeConfirmation,
  roleChangeFailureMessage,
  type OrganizationRole,
} from "./member-role";
import { teamAdminAssignment, teamAdminGrant, type TeamRole } from "./team-admin";
import { invitationTeamBody } from "./team-additions";
import type { HubAccount, HubManagedInvitation, HubMember, HubRun, TeamResources } from "./types";

/** Changes a Member's organization role; the Owner change asks first. */
export function useMemberRoleAction(hub: HubAccount, resources: TeamResources, run: HubRun) {
  const { members } = resources;
  return useCallback(
    async (member: HubMember, role: OrganizationRole) => {
      const confirmation = roleChangeConfirmation(member, role);
      if (confirmation !== null && !(await confirmDialog(confirmation))) return;
      await run(async () => {
        try {
          await hub.changeMemberRole({ memberId: member.id, role });
        } catch (error) {
          throw new Error(roleChangeFailureMessage(error), { cause: error });
        }
        await members.refetch();
      });
    },
    [hub, members, run],
  );
}

/**
 * Team Admin: grants or removes `hub.access.manage` on the Team. TODO(A): the Hub endpoint is
 * being built; a 400 or 404 marks it unsupported and the dropdown disables itself.
 */
export function useTeamAdminAction(hub: HubAccount, resources: TeamResources, run: HubRun) {
  const [unsupported, setUnsupported] = useState(false);
  const { assignments } = resources;
  const setTeamRole = useCallback(
    (teamId: string, member: HubMember, role: TeamRole) =>
      void run(async () => {
        const current = teamAdminAssignment(assignments.data?.assignments ?? [], teamId, member);
        try {
          if (role === "admin" && current === undefined) {
            await hub
              .api()
              .post(
                "access-assignments",
                teamAdminGrant(teamId, member),
                HubAccessAssignmentSchema,
              );
          } else if (role === "member" && current !== undefined) {
            await hub.api().delete(`access-assignments/${encodeURIComponent(current.id)}`);
          }
        } catch (error) {
          if (error instanceof HubApiError && (error.status === 400 || error.status === 404)) {
            setUnsupported(true);
            throw new Error("Team Admin is not available on this Hub yet.", { cause: error });
          }
          throw error;
        }
        await assignments.refetch();
      }),
    [assignments, hub, run],
  );
  return useMemo(() => ({ setTeamRole, unsupported }), [setTeamRole, unsupported]);
}

export function useInvitationActions(hub: HubAccount, run: HubRun) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Re-inviting with the same role and Teams restarts the invitation's 48-hour lifetime.
  const reinvite = useCallback(
    (invitation: HubManagedInvitation) =>
      void run(() =>
        hub.inviteMember({
          email: invitation.email,
          role: invitation.role,
          ...invitationTeamBody(invitationTeams(invitation).map(({ id }) => id)),
        }),
      ),
    [hub, run],
  );
  const cancel = useCallback(
    (invitation: HubManagedInvitation) => void run(() => hub.cancelInvitation(invitation.id)),
    [hub, run],
  );
  const copyLink = useCallback(
    (invitation: HubManagedInvitation) =>
      void run(async () => {
        await copyToClipboard(invitation.link);
        setCopiedId(invitation.id);
      }),
    [run],
  );
  return useMemo(
    () => ({ reinvite, cancel, copyLink, copiedId }),
    [cancel, copiedId, copyLink, reinvite],
  );
}

/** Links and unlinks Channel identities for a Member from the People screen. */
export function useIdentityActions(hub: HubAccount, resources: TeamResources, run: HubRun) {
  const { identities } = resources;
  const unlink = useCallback(
    async (id: string) => {
      const confirmed = await confirmDialog({
        title: "Unlink this chat account?",
        message: "Messages from this account will no longer resolve to the Member.",
        confirmLabel: "Unlink",
        destructive: true,
      });
      if (!confirmed) return;
      await run(async () => {
        await hub.api().delete(`channel-identities/${encodeURIComponent(id)}`);
        await identities.refetch();
      });
    },
    [hub, identities, run],
  );
  const link = useCallback(
    (body: {
      memberId: string;
      connectionId: string;
      externalSubjectId: string;
      displayName: string | null;
    }) =>
      run(async () => {
        await hub.api().post("channel-identities", body, HubChannelIdentitySchema);
        await identities.refetch();
      }),
    [hub, identities, run],
  );
  return useMemo(() => ({ unlink, link }), [link, unlink]);
}
