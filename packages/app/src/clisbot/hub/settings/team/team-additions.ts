import { invitationTeams } from "../../contracts";
import { invitationFailureMessage, parseInvitationEmails } from "../invitation-emails";
import { capitalizeLabel, countLabel } from "../labels";
import type { HubManagedInvitation, HubMember, HubTeam, InvitationRole } from "./types";

/**
 * What "Add people to Teams" will do: organization Members join the chosen Teams now, and
 * everyone else gets one invitation that joins the same Teams when they sign in.
 */
export interface TeamAdditionPlan {
  members: HubMember[];
  invitees: string[];
  /**
   * Invitees who already have a pending invitation, with the Teams it joins. Hub replaces an
   * invitation's Teams on re-invite, so the form sends these along to add rather than replace.
   */
  pending: Record<string, { teamIds: string[]; teamNames: string[] }>;
  invalid: string[];
  teamIds: string[];
}

export function planTeamAdditions(input: {
  pickedUserIds: readonly string[];
  emailText: string;
  teamIds: readonly string[];
  members: readonly HubMember[];
  teams: readonly HubTeam[];
  invitations: readonly HubManagedInvitation[];
}): TeamAdditionPlan {
  const { emails, invalid } = parseInvitationEmails(input.emailText);
  const memberByEmail = new Map(
    input.members.map((member) => [member.email.toLowerCase(), member]),
  );
  const picked = input.members.filter(({ userId }) => input.pickedUserIds.includes(userId));
  const typedMembers = emails.flatMap((email) => memberByEmail.get(email) ?? []);
  const members = [...picked, ...typedMembers].filter(
    (member, index, all) => all.findIndex(({ userId }) => userId === member.userId) === index,
  );
  const invitees = emails.filter((email) => !memberByEmail.has(email));
  return {
    members,
    invitees,
    pending: pendingInvitationTeams(invitees, input.invitations),
    invalid,
    teamIds: input.teamIds.filter((id) => input.teams.some((team) => team.id === id)),
  };
}

function pendingInvitationTeams(
  invitees: readonly string[],
  invitations: readonly HubManagedInvitation[],
): TeamAdditionPlan["pending"] {
  const pending: TeamAdditionPlan["pending"] = {};
  for (const email of invitees) {
    const invitation = invitations.find((candidate) => candidate.email.toLowerCase() === email);
    if (invitation === undefined) continue;
    const teams = invitationTeams(invitation);
    pending[email] = {
      teamIds: teams.map(({ id }) => id),
      teamNames: teams.map(({ name }) => name),
    };
  }
  return pending;
}

/**
 * Whether the plan can run. Existing Members need at least one Team, otherwise they would be
 * silently skipped; invitations alone may join the organization only.
 */
export function canApplyTeamAdditions(plan: TeamAdditionPlan): boolean {
  if (plan.invalid.length > 0) return false;
  if (plan.members.length > 0 && plan.teamIds.length === 0) return false;
  return plan.invitees.length > 0 || plan.members.length > 0;
}

export interface TeamAdditionFailure {
  /** A Member's user id, or an invitee email. */
  key: string;
  kind: "member" | "invitee";
  label: string;
  message: string;
}

export interface TeamAdditionPorts {
  addTeamMember(teamId: string, userId: string): Promise<void>;
  invite(input: {
    email: string;
    role: InvitationRole;
    teamId?: string;
    teamIds?: string[];
  }): Promise<void>;
}

/** Applies the plan one request at a time and reports who could not be added or invited. */
export async function applyTeamAdditions(
  plan: TeamAdditionPlan,
  role: InvitationRole,
  teams: readonly HubTeam[],
  ports: TeamAdditionPorts,
): Promise<TeamAdditionFailure[]> {
  const failures: TeamAdditionFailure[] = [];
  for (const member of plan.members) {
    const missingTeamIds = plan.teamIds.filter(
      (teamId) => !teams.find(({ id }) => id === teamId)?.userIds.includes(member.userId),
    );
    try {
      for (const teamId of missingTeamIds) await ports.addTeamMember(teamId, member.userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hub request failed";
      failures.push({ key: member.userId, kind: "member", label: member.email, message });
    }
  }
  for (const email of plan.invitees) {
    const teamIds = [...new Set([...(plan.pending[email]?.teamIds ?? []), ...plan.teamIds])];
    try {
      await ports.invite({ email, role, ...invitationTeamBody(teamIds) });
    } catch (error) {
      const message = invitationFailureMessage(error);
      failures.push({ key: email, kind: "invitee", label: email, message });
    }
  }
  return failures;
}

/**
 * The invitation body's Team fields. Hubs before multi-Team invitations reject an unknown
 * `teamIds` key, so an invitation with one Team or none stays readable by them.
 */
export function invitationTeamBody(teamIds: readonly string[]): {
  teamId?: string;
  teamIds?: string[];
} {
  // COMPAT(invitationTeamId): send `teamIds` only when a single `teamId` cannot express it;
  // after 2027-03-17 always send `teamIds`.
  if (teamIds.length === 0) return {};
  const [only] = teamIds;
  return teamIds.length === 1 && only !== undefined ? { teamId: only } : { teamIds: [...teamIds] };
}

/**
 * Reads the one People field of the Invite modal: entries separated by commas, semicolons, or new
 * lines. An entry with an address is an email (a Member's email is recognized by the plan); any
 * other entry is a name matched to a Member, case-insensitively.
 */
export function readPeopleInput(
  text: string,
  members: readonly HubMember[],
): { pickedUserIds: string[]; emailText: string; unknown: string[] } {
  const pickedUserIds: string[] = [];
  const emailParts: string[] = [];
  const unknown: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const entry = raw.trim();
    if (entry.length === 0) continue;
    if (entry.includes("@")) {
      emailParts.push(entry);
      continue;
    }
    const match = members.find(({ name }) => name.trim().toLowerCase() === entry.toLowerCase());
    if (match === undefined) unknown.push(entry);
    else if (!pickedUserIds.includes(match.userId)) pickedUserIds.push(match.userId);
  }
  return { pickedUserIds, emailText: emailParts.join("\n"), unknown };
}

/**
 * One line that says what the plan will do, for the Invite modal's preview:
 * "2 Members join Ops, BMS now · 1 invitation will be sent · 1 pending invitation gains Teams".
 */
export function invitePreview(plan: TeamAdditionPlan, teams: readonly HubTeam[]): string {
  const teamNames = plan.teamIds.flatMap((id) => teams.find((team) => team.id === id)?.name ?? []);
  const pendingCount = Object.keys(plan.pending).length;
  const newCount = plan.invitees.length - pendingCount;
  const parts: string[] = [];
  if (plan.members.length > 0 && teamNames.length > 0) {
    const verb = plan.members.length === 1 ? "joins" : "join";
    parts.push(`${countLabel(plan.members.length, "Member")} ${verb} ${teamNames.join(", ")} now`);
  }
  if (newCount > 0) parts.push(`${countLabel(newCount, "invitation")} will be sent`);
  if (pendingCount > 0) {
    const effect = pendingInvitationEffect(pendingCount, teamNames.length > 0);
    parts.push(`${countLabel(pendingCount, "pending invitation")} ${effect}`);
  }
  return parts.join(" · ");
}

/** "gains Teams" when Teams are chosen, otherwise only the lifetime restarts. */
function pendingInvitationEffect(count: number, joinsTeams: boolean): string {
  if (joinsTeams) return count === 1 ? "gains Teams" : "gain Teams";
  return count === 1 ? "is renewed" : "are renewed";
}

/** Notes for invitees who already have a pending invitation: its Teams stay, its role and expiry are renewed. */
export function pendingInvitationNotes(plan: TeamAdditionPlan, role: InvitationRole): string[] {
  return Object.entries(plan.pending).map(([email, { teamNames }]) => {
    const kept = teamNames.length === 0 ? "" : `, keeps ${teamNames.join(", ")}`;
    return `${email} already has a pending invitation${kept}; it is renewed as ${capitalizeLabel(role)}.`;
  });
}
