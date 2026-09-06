import { describe, expect, it } from "vitest";
import { HubAccessAssignmentSchema, HubMemberSchema, HubTeamSchema } from "../contracts";
import { assignmentsForSubject, publicAccessRoutes } from "./access-overview";

const member = HubMemberSchema.parse({
  id: "membership",
  userId: "user",
  name: "Member",
  email: "member@example.test",
  role: "member",
});
const team = HubTeamSchema.parse({
  id: "team",
  name: "Team",
  userIds: ["user"],
  createdAt: "now",
  updatedAt: null,
});
const assignments = [
  { subjectKind: "member", subjectId: "membership", id: "direct" },
  { subjectKind: "team", subjectId: "team", id: "inherited" },
  { subjectKind: "member", subjectId: "someone-else", id: "other" },
].map((subject) =>
  HubAccessAssignmentSchema.parse({
    ...subject,
    organizationId: "org",
    resourceKind: "daemon",
    resourceId: "host",
    privileges: ["daemon.connect"],
    constraints: {},
    createdAt: "now",
    updatedAt: "now",
  }),
);

describe("Access overview projections", () => {
  it("finds direct access by membership ID and inherited Teams by user ID", () => {
    expect(
      assignmentsForSubject(assignments, { kind: "member", id: member.id }, [member], [team]).map(
        ({ id }) => id,
      ),
    ).toEqual(["direct", "inherited"]);
    expect(
      assignmentsForSubject(assignments, { kind: "member", id: member.userId }, [member], [team]),
    ).toEqual([]);
    expect(
      assignmentsForSubject(assignments, { kind: "team", id: team.id }, [member], [team]).map(
        ({ id }) => id,
      ),
    ).toEqual(["inherited"]);
  });

  it("does not retain inherited access after removal from a Team", () => {
    expect(
      assignmentsForSubject(
        assignments,
        { kind: "member", id: member.id },
        [member],
        [{ ...team, userIds: [] }],
      ).map(({ id }) => id),
    ).toEqual(["direct"]);
  });

  it("projects public Routes from the published Channel configuration without creating assignments", () => {
    expect(
      publicAccessRoutes([
        {
          channel: "slack",
          accountId: "support",
          enabled: false,
          routes: [
            {
              audience: { kind: "members" },
              match: { kind: "channel", ids: ["private"] },
              agent: "internal",
            },
            {
              audience: { kind: "conversationParticipants" },
              match: { kind: "channel", ids: ["C1"] },
              workflow: "support",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        key: "slack:support:1",
        account: "slack · support",
        enabled: false,
        conversations: "C1",
        target: "support",
      },
    ]);
  });
});
