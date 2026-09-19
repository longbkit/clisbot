import { useCallback, useMemo, useState } from "react";
import { countLabel } from "../labels";
import { teamAccessReady } from "./invite-access-note";
import {
  applyTeamAdditions,
  canApplyTeamAdditions,
  planTeamAdditions,
  readPeopleInput,
  type TeamAdditionPlan,
} from "./team-additions";
import type {
  HubAccount,
  HubManagedInvitation,
  HubMember,
  InvitationRole,
  TeamResources,
} from "./types";
import type { TeamActions } from "./use-team-actions";

/** What the Invite people modal opens with: Teams and Members chosen from where it was opened. */
export interface InviteRequest {
  teamIds: readonly string[];
  members: readonly HubMember[];
}

export interface InviteDraft {
  /** Names and emails, one field; see `readPeopleInput`. */
  text: string;
  teamIds: readonly string[];
  role: InvitationRole;
  /** Bumped when the text field must show a value it did not type itself. */
  textResetKey: number;
}

const EMPTY_INVITATIONS: HubManagedInvitation[] = [];
const EMPTY_MEMBERS: HubMember[] = [];

/** The open Invite people modal, or null. Each open starts a fresh draft. */
export function useInviteRequest() {
  const [request, setRequest] = useState<(InviteRequest & { key: number }) | null>(null);
  const open = useCallback((input: Partial<InviteRequest> = {}) => {
    setRequest((current) => ({
      teamIds: input.teamIds ?? [],
      members: input.members ?? [],
      key: (current?.key ?? 0) + 1,
    }));
  }, []);
  const close = useCallback(() => setRequest(null), []);
  return useMemo(() => ({ request, open, close }), [close, open, request]);
}

export function useInviteDraft(request: InviteRequest) {
  const [draft, setDraft] = useState<InviteDraft>(() => ({
    text: request.members.map(({ email }) => email).join("\n"),
    teamIds: request.teamIds,
    role: "member",
    textResetKey: 0,
  }));
  const update = useCallback(
    (patch: Partial<InviteDraft>) => setDraft((current) => ({ ...current, ...patch })),
    [],
  );
  return useMemo(() => ({ draft, update }), [draft, update]);
}

export type InviteDraftState = ReturnType<typeof useInviteDraft>;

export interface InvitePlan {
  plan: TeamAdditionPlan;
  /** Entries that are neither an email nor a Member's name. */
  unknown: string[];
  /** Whether the plan can be sent: everything recognized, the roster loaded, nothing pending. */
  ready: boolean;
}

export function useInvitePlan(
  draft: InviteDraft,
  resources: TeamResources,
  invitations: readonly HubManagedInvitation[] | undefined,
  pending: boolean,
): InvitePlan {
  const members = resources.members.data?.members ?? EMPTY_MEMBERS;
  const teams = resources.teams.data?.teams;
  return useMemo(() => {
    const input = readPeopleInput(draft.text, members);
    const plan = planTeamAdditions({
      pickedUserIds: input.pickedUserIds,
      emailText: input.emailText,
      teamIds: draft.teamIds,
      members,
      teams: teams ?? [],
      invitations: invitations ?? EMPTY_INVITATIONS,
    });
    // Until the roster loads, a typed Member email would be mistaken for a new person.
    const ready =
      resources.members.data !== undefined &&
      input.unknown.length === 0 &&
      canApplyTeamAdditions(plan) &&
      teamAccessReady(resources, plan.teamIds) &&
      !pending;
    return { plan, unknown: input.unknown, ready };
  }, [draft.teamIds, draft.text, invitations, members, pending, resources, teams]);
}

/**
 * Applies the plan. Whoever the Hub refused stays in the field with the same Teams and role,
 * ready to retry; a clean run closes the modal with a one-line result.
 */
export function useSubmitInvite({
  hub,
  resources,
  actions,
  draftState,
  plan,
  onDone,
}: {
  hub: HubAccount;
  resources: TeamResources;
  actions: TeamActions;
  draftState: InviteDraftState;
  plan: TeamAdditionPlan;
  onDone(result: string): void;
}) {
  const { draft, update } = draftState;
  return useCallback(() => {
    void actions.run(async () => {
      const failures = await applyTeamAdditions(
        plan,
        draft.role,
        resources.teams.data?.teams ?? [],
        { addTeamMember: actions.addTeamMember, invite: (input) => hub.inviteMember(input) },
      );
      await Promise.all([
        resources.teams.refetch(),
        resources.assignments.refetch(),
        hub.refresh(),
      ]);
      if (failures.length === 0) {
        onDone(inviteResult(plan));
        return;
      }
      update({
        text: failures.map(({ label }) => label).join("\n"),
        textResetKey: draft.textResetKey + 1,
      });
      const done = plan.members.length + plan.invitees.length - failures.length;
      const details = failures.map(({ label, message }) => `${label}: ${message}`).join("; ");
      throw new Error(`${String(done)} of ${String(done + failures.length)} done. ${details}`);
    });
  }, [actions, draft.role, draft.textResetKey, hub, onDone, plan, resources, update]);
}

function inviteResult(plan: TeamAdditionPlan): string {
  const added = plan.teamIds.length > 0 ? plan.members.length : 0;
  const parts = [
    ...(added > 0 ? [`Added ${countLabel(added, "Member")} to Teams`] : []),
    ...(plan.invitees.length > 0 ? [`Sent ${countLabel(plan.invitees.length, "invitation")}`] : []),
  ];
  return `${parts.join(" · ")}.`;
}
