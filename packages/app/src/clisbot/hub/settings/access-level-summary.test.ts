import { describe, expect, it } from "vitest";
import {
  accessChanges,
  accessLevelDescription,
  matchingAccessLevel,
  summarizeAccess,
} from "./access-level-summary";

const OFFICE_WORKER = ["project.use", "agent.interact", "agent.create", "approval.file"];
const DEVELOPER = [
  "project.use",
  "workspace.create",
  "agent.interact",
  "agent.create",
  "terminal.use",
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
  "approval.other",
];
const FULL_ACCESS = [...DEVELOPER, "workspace.manage"];
const LEVELS = {
  daemon: {
    connect: ["daemon.connect"],
    developer: ["daemon.connect", ...DEVELOPER],
    full_access: ["daemon.connect", ...FULL_ACCESS],
  },
  project: { office_worker: OFFICE_WORKER, developer: DEVELOPER },
};

describe("summarizeAccess", () => {
  it("tells Office worker what it leaves out", () => {
    const summary = summarizeAccess({ privileges: OFFICE_WORKER, resourceKind: "project" });
    expect(summary.allows).toContain("Approve file edits");
    expect(summary.withholds).toEqual([
      "No terminal",
      "Cannot approve shell commands",
      "Cannot create workspaces or worktrees",
      "Cannot create, rename, or remove Projects",
    ]);
    expect(summary.cautions).toEqual([]);
  });

  it("separates Developer from Full access by Project management alone", () => {
    const developer = summarizeAccess({ privileges: DEVELOPER, resourceKind: "project" });
    expect(developer.allows).toContain("Run agents without asking for approval");
    expect(developer.withholds).toEqual(["Cannot create, rename, or remove Projects"]);
    expect(
      accessChanges({ before: DEVELOPER, after: FULL_ACCESS, resourceKind: "project" }),
    ).toEqual({
      added: [
        "Create Projects inside this Project's folder",
        "Rename, remove, or archive this Project and its workspaces and worktrees",
      ],
      removed: [],
    });
  });

  it("says a Host grant reaches every Project and any folder", () => {
    const summary = summarizeAccess({
      privileges: ["daemon.connect", ...FULL_ACCESS],
      resourceKind: "daemon",
    });
    expect(summary.allows).toContain(
      "Use every Project on this Host, including Projects added later",
    );
    expect(summary.allows).toContain("Create Projects in any folder on this Host");
    expect(summary.cautions).toContain("Any folder this machine can read can become a Project");
    expect(summary.cautions).toContain(
      "A Project assignment can add to this grant, never narrow it",
    );
  });

  it("warns that Administrator escapes model limits and Guest is not one person", () => {
    const admin = summarizeAccess({
      privileges: ["daemon.connect", "daemon.manage"],
      resourceKind: "daemon",
      subjectKind: "guest",
    });
    expect(admin.cautions).toEqual([
      "Guest is every channel sender without a linked Member, not one person",
      "Not limited to the allowed models, and can change who reaches this Host",
    ]);
  });

  it("describes Connect as reaching no Project", () => {
    expect(summarizeAccess({ privileges: ["daemon.connect"], resourceKind: "daemon" })).toEqual({
      allows: ["Connect to this Host"],
      withholds: ["No Project until one is granted"],
      cautions: [],
    });
  });

  it("lists removed effects when a grant is narrowed", () => {
    expect(
      accessChanges({ before: DEVELOPER, after: OFFICE_WORKER, resourceKind: "project" }).removed,
    ).toEqual([
      "Create workspaces and worktrees",
      "Open terminals",
      "Approve every action, destructive commands included",
      "Run agents without asking for approval",
    ]);
  });
});

describe("level names", () => {
  it("describes Full access by where it is granted", () => {
    expect(accessLevelDescription("full_access", "daemon")).toContain("any folder");
    expect(accessLevelDescription("full_access", "project")).toContain("this Project");
    expect(accessLevelDescription("future_level", "project")).toBeUndefined();
  });

  it("matches a saved grant to its level, ignoring Fast mode", () => {
    expect(matchingAccessLevel(LEVELS, "project", [...DEVELOPER, "agent.fast.use"])).toBe(
      "developer",
    );
    expect(matchingAccessLevel(LEVELS, "project", ["project.use"])).toBeUndefined();
    expect(matchingAccessLevel(LEVELS, "automation", ["automation.run"])).toBeUndefined();
  });
});
