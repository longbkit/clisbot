import { describe, expect, it } from "vitest";
import type { AccessAssignment, AccessResource, HubMember, HubTeam } from "./access-catalog";
import { grantRows, groupGrantRows } from "./access-grant-rows";

const host = { kind: "daemon", id: "host", name: "LongPro2Max", parent: null } as AccessResource;
const project = {
  kind: "project",
  id: "brain",
  name: "brain",
  parent: { kind: "daemon", id: "host" },
} as AccessResource;
const members = [
  { id: "m-ai", userId: "u-ai", name: "Ai Tran" },
  { id: "m-bao", userId: "u-bao", name: "Bao" },
] as HubMember[];
const teams = [{ id: "t-qc", name: "QC", userIds: ["u-ai"] }] as HubTeam[];

function grant(overrides: Partial<AccessAssignment>): AccessAssignment {
  return {
    id: "g",
    subjectKind: "team",
    subjectId: "t-qc",
    resourceKind: "project",
    resourceId: "brain",
    privileges: [],
    constraints: {},
    createdByUserId: "u-bao",
    ...overrides,
  } as AccessAssignment;
}

const assignments = [
  grant({ id: "team-project" }),
  grant({
    id: "ai-host",
    subjectKind: "member",
    subjectId: "m-ai",
    resourceKind: "daemon",
    resourceId: "host",
  }),
];
const rows = grantRows({
  assignments,
  resources: [host, project],
  members,
  teams,
  memberNameByUserId: new Map([["u-bao", "Bao"]]),
  levelLabel: (assignment) =>
    assignment.resourceKind === "daemon" ? "Developer" : "Office worker",
  sharesAccess: (assignment) => assignment.id === "ai-host",
  locked: () => false,
});
const directory = { members, teams, resources: [host, project] };

describe("grantRows", () => {
  it("gives each grant one fact per field: the thing, its kind and parent, level, modifiers, author", () => {
    expect(rows[0]).toMatchObject({
      subject: { kind: "team", name: "QC" },
      resource: { name: "brain", context: "Project · LongPro2Max" },
      level: "Office worker",
      details: [],
      grantedBy: "Bao",
      via: null,
    });
    expect(rows[1]!.details).toEqual(["Can share"]);
  });
});

describe("groupGrantRows", () => {
  it("groups by people, Teams first, and lists a Member's Team grants under them, not editable", () => {
    const groups = groupGrantRows(rows, "subject", "", directory);
    expect(groups.map(({ title, subtitle }) => [title, subtitle])).toEqual([
      ["QC", "Team · 1 Member"],
      ["Ai Tran", "Member"],
    ]);
    const ai = groups[1]!.rows;
    expect(ai.map((row) => [row.resource.name, row.via, row.assignment === null])).toEqual([
      ["LongPro2Max", null, false],
      ["brain", "Team QC", true],
    ]);
  });

  it("groups by resource, Hosts before Projects", () => {
    const groups = groupGrantRows(rows, "resource", "", directory);
    expect(groups.map(({ title }) => title)).toEqual(["LongPro2Max", "brain"]);
  });

  it("narrows to matching groups or rows, and finds a Member who only has Team grants", () => {
    expect(groupGrantRows(rows, "resource", "brain", directory).map(({ title }) => title)).toEqual([
      "brain",
    ]);
    const onlyTeam = groupGrantRows([rows[0]!], "subject", "tran", directory);
    expect(onlyTeam.map(({ title }) => title)).toEqual(["Ai Tran"]);
    expect(onlyTeam[0]!.rows[0]!.via).toBe("Team QC");
  });

  it("lists a Host grant that carries Project use under each Project, not editable there", () => {
    const hostGrant = grantRows({
      assignments: [
        grant({
          id: "bao-host",
          subjectKind: "member",
          subjectId: "m-bao",
          resourceKind: "daemon",
          resourceId: "host",
          privileges: ["daemon.connect", "project.use"],
        }),
      ],
      resources: [host, project],
      members,
      teams,
      memberNameByUserId: new Map(),
      levelLabel: () => "Developer",
      sharesAccess: () => false,
      locked: () => false,
    });
    const brain = groupGrantRows(hostGrant, "resource", "brain", directory);
    expect(brain.map(({ title, subtitle }) => [title, subtitle])).toEqual([
      ["brain", "Project · LongPro2Max"],
    ]);
    expect(brain[0]!.rows.map((row) => [row.subject.name, row.via, row.assignment])).toEqual([
      ["Bao", "Host LongPro2Max", null],
    ]);
  });

  it("keeps Guest apart and drops Team grants from a Member who left the Team", () => {
    const guestRows = grantRows({
      assignments: [grant({ id: "guest", subjectKind: "guest", subjectId: "guest" })],
      resources: [host, project],
      members,
      teams,
      memberNameByUserId: new Map(),
      levelLabel: () => "Connect",
      sharesAccess: () => false,
      locked: () => false,
    });
    expect(groupGrantRows(guestRows, "subject", "", directory)[0]).toMatchObject({
      title: "Guest",
      subtitle: "Channel senders without a linked Member",
    });
    const left = groupGrantRows(rows, "subject", "tran", {
      ...directory,
      teams: [{ ...teams[0]!, userIds: [] }],
    });
    expect(left.flatMap((group) => group.rows).map((row) => row.via)).toEqual([null]);
  });
});
