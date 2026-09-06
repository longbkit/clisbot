import { z } from "zod";
import type { HubAccessAssignmentSchema, HubMemberSchema, HubTeamSchema } from "../contracts";

export function assignmentsForSubject(
  assignments: z.infer<typeof HubAccessAssignmentSchema>[],
  subject: { kind: "team" | "member"; id: string } | null,
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

const routeSchema = z.object({
  audience: z.object({ kind: z.literal("conversationParticipants") }),
  match: z.object({ kind: z.string(), ids: z.array(z.string()).optional() }),
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

/** Published Route configuration stays authoritative; this is only an Access projection. */
export function publicAccessRoutes(accounts: Record<string, unknown>[]) {
  return accounts.flatMap((value) => {
    const account = accountSchema.safeParse(value);
    if (!account.success) return [];
    return account.data.routes.flatMap((routeValue, index) => {
      const route = routeSchema.safeParse(routeValue);
      if (!route.success) return [];
      return [
        {
          key: `${account.data.channel}:${account.data.accountId}:${String(index)}`,
          account: `${account.data.channel} · ${account.data.accountId}`,
          enabled: account.data.enabled !== false && route.data.enabled !== false,
          conversations: route.data.match.ids?.join(", ") || `Any ${route.data.match.kind}`,
          target: route.data.workflow ?? route.data.agent ?? "Target unavailable",
        },
      ];
    });
  });
}
