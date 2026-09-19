import { describe, expect, it } from "vitest";
import type { AccessAssignment, AccessResource, HubMember, HubTeam } from "./access-catalog";
import { accessEntries, entryFilterChips, filterEntries } from "./access-browser-model";
import { grantRows } from "./access-grant-rows";

const host = { kind: "daemon", id: "host", name: "LongPro2Max", parent: null } as AccessResource;
const project = {
  kind: "project",
  id: "brain",
  name: "brain",
  parent: { kind: "daemon", id: "host" },
} as AccessResource;
const members = [
  { id: "m-ai", userId: "u-ai", name: "Ai Tran", email: "ai@example.test" },
  { id: "m-bao", userId: "u-bao", name: "Bao", email: "bao@example.test" },
] as HubMember[];
const teams = [{ id: "t-qc", name: "QC", userIds: ["u-ai"] }] as HubTeam[];
const directory = { members, teams, resources: [host, project] };

const rows = grantRows({
  assignments: [
    {
      id: "team-host",
      subjectKind: "team",
      subjectId: "t-qc",
      resourceKind: "daemon",
      resourceId: "host",
      privileges: ["daemon.connect", "project.use"],
      constraints: {},
      createdByUserId: null,
    } as AccessAssignment,
  ],
  resources: [host, project],
  members,
  teams,
  memberNameByUserId: new Map(),
  levelLabel: () => "Developer",
  sharesAccess: () => false,
  locked: () => false,
});

describe("accessEntries", () => {
  it("lists everyone, with access first, a Member by email, and opens the grant sheet on them", () => {
    const entries = accessEntries(rows, "subject", directory);
    expect(
      entries.map(({ title, subtitle, rows: grants }) => [title, subtitle, grants.length]),
    ).toEqual([
      ["QC", "Team · 1 Member", 1],
      ["Ai Tran", "ai@example.test", 1],
      ["Bao", "bao@example.test", 0],
      ["Guest", "Channel senders without a linked Member", 0],
    ]);
    expect(entries[2]!.target).toEqual({ subject: "member\0m-bao", resource: null });
  });

  it("counts a Project reached only through its Host as having access", () => {
    const entries = accessEntries(rows, "resource", directory);
    const brain = entries.find(({ key }) => key === "project:brain")!;
    expect(brain.rows.map((row) => row.via)).toEqual(["Host LongPro2Max"]);
    expect(brain.target).toEqual({ subject: null, resource: "project\0brain" });
  });
});

describe("filters", () => {
  const entries = accessEntries(rows, "subject", directory);

  it("offers every kind present, then No access, with counts", () => {
    expect(entryFilterChips(entries, "subject").map(({ label, count }) => [label, count])).toEqual([
      ["With access", 2],
      ["Teams", 1],
      ["Members", 1],
      ["No access", 2],
    ]);
  });

  it("filters by kind and searches name or email", () => {
    expect(filterEntries(entries, "member", "").map(({ title }) => title)).toEqual(["Ai Tran"]);
    expect(filterEntries(entries, "none", "bao@").map(({ title }) => title)).toEqual(["Bao"]);
    expect(filterEntries(entries, "all", "nobody")).toEqual([]);
  });
});
