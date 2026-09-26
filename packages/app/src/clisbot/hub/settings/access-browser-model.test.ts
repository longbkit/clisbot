import { describe, expect, it } from "vitest";
import type { AccessAssignment, AccessResource, HubMember, HubTeam } from "./access-catalog";
import {
  accessEntries,
  entryFilterChips,
  entryStatus,
  filterEntries,
  memberTeamEntries,
} from "./access-browser-model";
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

describe("a Member's Teams", () => {
  it("lists every Team the Member is in, with or without access", () => {
    const withEmptyTeam = {
      ...directory,
      teams: [...teams, { id: "t-empty", name: "Design", userIds: ["u-ai"] }] as HubTeam[],
    };
    const entries = accessEntries(rows, "subject", withEmptyTeam);
    const ai = entries.find(({ title }) => title === "Ai Tran")!;
    expect(memberTeamEntries(ai, entries).map((team) => [team.title, entryStatus(team)])).toEqual([
      ["QC", "1 grant"],
      ["Design", "No access"],
    ]);
    const bao = entries.find(({ title }) => title === "Bao")!;
    expect(memberTeamEntries(bao, entries)).toEqual([]);
  });
});

describe("filters", () => {
  const entries = accessEntries(rows, "subject", directory);

  it("starts from All, then every kind present, then with and without access", () => {
    expect(entryFilterChips(entries, "subject").map(({ label, count }) => [label, count])).toEqual([
      ["All", 4],
      ["Teams", 1],
      ["Members", 2],
      ["Guest", 1],
      ["With access", 2],
      ["No access", 2],
    ]);
    expect(filterEntries(entries, "all", "")).toHaveLength(4);
    expect(filterEntries(entries, "with", "").map(({ title }) => title)).toEqual(["QC", "Ai Tran"]);
  });

  it("counts an Owner or Admin as having access through their role, not as No access", () => {
    const withRoles = {
      ...directory,
      members: [
        ...members,
        { id: "m-own", userId: "u-own", name: "Owen", email: "o@example.test", role: "owner" },
        { id: "m-adm", userId: "u-adm", name: "Ada", email: "a@example.test", role: "admin" },
      ] as HubMember[],
    };
    const all = accessEntries(rows, "subject", withRoles);
    const none = filterEntries(all, "none", "").map(({ title }) => title);
    expect(none).toEqual(["Bao", "Guest"]);
    const byTitle = new Map(all.map((entry) => [entry.title, entryStatus(entry)]));
    expect(byTitle.get("Owen")).toBe("Owner, full access");
    expect(byTitle.get("Ada")).toBe("Admin role");
    expect(byTitle.get("Ai Tran")).toBe("1 grant");
    expect(byTitle.get("Bao")).toBe("No access");
  });

  it("filters by kind and searches name or email", () => {
    expect(filterEntries(entries, "member", "").map(({ title }) => title)).toEqual([
      "Ai Tran",
      "Bao",
    ]);
    expect(filterEntries(entries, "none", "bao@").map(({ title }) => title)).toEqual(["Bao"]);
    expect(filterEntries(entries, "all", "nobody")).toEqual([]);
  });
});
