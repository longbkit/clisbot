import { describe, expect, it } from "vitest";
import { HubAccessAssignmentSchema, HubMemberSchema, HubTeamSchema } from "../contracts";
import {
  assignmentsForResource,
  assignmentsForSubject,
  publicAccessRoutes,
} from "./access-overview";

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
  { subjectKind: "guest", subjectId: "guest", id: "guest-grant" },
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
  it("counts a Host assignment with Project authority as access to each Project on it", () => {
    const row = (id: string, resourceKind: string, resourceId: string, privileges: string[]) =>
      HubAccessAssignmentSchema.parse({
        id,
        organizationId: "org",
        subjectKind: "member",
        subjectId: "membership",
        resourceKind,
        resourceId,
        privileges,
        constraints: {},
        createdAt: "now",
        updatedAt: "now",
      });
    const rows = [
      row("exact", "project", "project-a", ["project.use"]),
      row("host-developer", "daemon", "host", ["daemon.connect", "project.use"]),
      // Connect alone opens the Host, not its Projects.
      row("host-connect", "daemon", "host", ["daemon.connect"]),
      row("other-host", "daemon", "elsewhere", ["daemon.connect", "project.use"]),
      row("sibling", "project", "project-b", ["project.use"]),
    ];
    const projectA = { kind: "project", id: "project-a", parent: { kind: "daemon", id: "host" } };
    expect(assignmentsForResource(rows, projectA).map(({ id }) => id)).toEqual([
      "exact",
      "host-developer",
    ]);
    const host = { kind: "daemon", id: "host", parent: null };
    expect(assignmentsForResource(rows, host).map(({ id }) => id)).toEqual([
      "host-developer",
      "host-connect",
    ]);
  });

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

  it("shows Guest assignments separately from Member and Team assignments", () => {
    expect(
      assignmentsForSubject(assignments, { kind: "guest", id: "guest" }, [member], [team]).map(
        ({ id }) => id,
      ),
    ).toEqual(["guest-grant"]);
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
