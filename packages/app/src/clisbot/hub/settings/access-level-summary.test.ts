import { describe, expect, it } from "vitest";
import {
  accessChanges,
  accessLevelDescription,
  canShareDescription,
  matchingAccessLevel,
  sharesAccess,
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
    full_access: ["daemon.connect", ...FULL_ACCESS, "hub.access.manage"],
  },
  project: { office_worker: OFFICE_WORKER, developer: DEVELOPER },
  team: { admin: ["hub.access.manage"] },
  automation: { run: ["automation.run"], admin: ["automation.run", "hub.access.manage"] },
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
    expect(matchingAccessLevel(LEVELS, "channel_account", ["channel.use"])).toBeUndefined();
  });

  it("matches a Host or Project level with or without Can share, and keeps Admin whole", () => {
    // Can share rides on top of Office worker and Developer, like Fast mode.
    expect(matchingAccessLevel(LEVELS, "project", [...DEVELOPER, "hub.access.manage"])).toBe(
      "developer",
    );
    // A Full access row written before Can share existed still reads as Full access.
    expect(matchingAccessLevel(LEVELS, "daemon", ["daemon.connect", ...FULL_ACCESS])).toBe(
      "full_access",
    );
    // On a Team or Automation the privilege is the level itself.
    expect(matchingAccessLevel(LEVELS, "team", ["hub.access.manage"])).toBe("admin");
    expect(matchingAccessLevel(LEVELS, "automation", ["automation.run"])).toBe("run");
    expect(matchingAccessLevel(LEVELS, "automation", ["automation.run", "hub.access.manage"])).toBe(
      "admin",
    );
  });

  it("describes Admin by the scope it manages", () => {
    expect(accessLevelDescription("admin", "team")).toContain("Team Admin");
    expect(accessLevelDescription("admin", "automation")).toContain("Automation");
  });
});

describe("Can share", () => {
  it("is the same privilege as Admin, but only a flag on a Host or Project", () => {
    expect(sharesAccess("project", [...OFFICE_WORKER, "hub.access.manage"])).toBe(true);
    expect(sharesAccess("daemon", ["daemon.connect", ...FULL_ACCESS])).toBe(false);
    expect(sharesAccess("team", ["hub.access.manage"])).toBe(false);
  });

  it("words Can share the same in the summary and under the switch", () => {
    expect(canShareDescription("daemon")).toBe(
      "Add, change, or remove people on this Host, up to their own level",
    );
    const summary = summarizeAccess({
      privileges: [...OFFICE_WORKER, "hub.access.manage"],
      resourceKind: "project",
    });
    expect(summary.allows).toContain(canShareDescription("project"));
    expect(
      summarizeAccess({ privileges: OFFICE_WORKER, resourceKind: "project" }).allows,
    ).not.toContain(canShareDescription("project"));
    expect(
      summarizeAccess({ privileges: ["daemon.connect", "daemon.manage"], resourceKind: "daemon" })
        .allows,
    ).toContain(canShareDescription("daemon"));
  });

  it("summarizes Team Admin as membership only", () => {
    const summary = summarizeAccess({ privileges: ["hub.access.manage"], resourceKind: "team" });
    expect(summary.allows).toEqual([
      "Add or remove people in this Team and invite Members into it",
      "Appoint another Team Admin",
    ]);
    expect(summary.withholds).toEqual([
      "Cannot change the Team's access grants or delete the Team",
    ]);
  });
});
