import { z } from "zod";
import type { HubAccessAssignmentSchema, HubMemberSchema, HubTeamSchema } from "../contracts";
import {
  audienceWhereLabel,
  routeAudienceDraft,
  type AudienceNames,
} from "./channel-route-audience";

export function assignmentsForSubject(
  assignments: z.infer<typeof HubAccessAssignmentSchema>[],
  subject: { kind: "team" | "member" | "guest"; id: string } | null,
  members: z.infer<typeof HubMemberSchema>[],
  teams: z.infer<typeof HubTeamSchema>[],
) {
  if (!subject) return [];
  const member = members.find(({ id }) => subject.kind === "member" && id === subject.id);
  const inheritedTeams = new Set(
    teams.filter((team) => member && team.userIds.includes(member.userId)).map(({ id }) => id),
  );
  return assignments.filter(
    (assignment) =>
      (assignment.subjectKind === subject.kind && assignment.subjectId === subject.id) ||
      (assignment.subjectKind === "team" && inheritedTeams.has(assignment.subjectId)),
  );
}

/**
 * Assignments that give access to one Resource. A Project is also reached by an
 * assignment on its Host that carries Project authority, so "who has access to
 * this Project" must include those rows or it undercounts the common case.
 */
export function assignmentsForResource(
  assignments: z.infer<typeof HubAccessAssignmentSchema>[],
  resource: { kind: string; id: string; parent: { kind: string; id: string } | null } | undefined,
) {
  if (resource === undefined) return [];
  const parentHost =
    resource.kind === "project" && resource.parent?.kind === "daemon" ? resource.parent.id : null;
  return assignments.filter(
    (assignment) =>
      (assignment.resourceKind === resource.kind && assignment.resourceId === resource.id) ||
      (parentHost !== null &&
        assignment.resourceKind === "daemon" &&
        assignment.resourceId === parentHost &&
        assignment.privileges.includes("project.use")),
  );
}

const routeSchema = z.object({
  enabled: z.boolean().optional(),
  workflow: z.string().optional(),
  agent: z.string().optional(),
});
const accountSchema = z.object({
  channel: z.string(),
  accountId: z.string(),
  enabled: z.boolean().optional(),
  routes: z.array(z.unknown()),
});

/** The Access page names places by their ids; Channels resolves them to room names. */
const ID_NAMES: AudienceNames = {
  teamName: (id) => id,
  memberName: (id) => id,
  conversationLabel: (id) => id,
};

/**
 * Routes with a rule whose Who is Anyone, and where those rules apply.
 * Published Route configuration stays authoritative; this is only an Access projection.
 */
export function publicAccessRoutes(accounts: Record<string, unknown>[]) {
  return accounts.flatMap((value) => {
    const account = accountSchema.safeParse(value);
    if (!account.success) return [];
    return account.data.routes.flatMap((routeValue, index) => {
      const route = routeSchema.safeParse(routeValue);
      if (!route.success) return [];
      const rules = routeAudienceDraft(routeValue as Record<string, unknown>).rules;
      const open = rules.filter((rule) => rule.who.anyone);
      if (open.length === 0) return [];
      return [
        {
          key: `${account.data.channel}:${account.data.accountId}:${String(index)}`,
          account: `${account.data.channel} · ${account.data.accountId}`,
          enabled: account.data.enabled !== false && route.data.enabled !== false,
          conversations: open.map((rule) => audienceWhereLabel(rule.where, ID_NAMES)).join("; "),
          target: route.data.workflow ?? route.data.agent ?? "Target unavailable",
        },
      ];
    });
  });
}
