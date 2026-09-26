import { describe, expect, it } from "vitest";
import {
  accessChanges,
  accessLevelDescription,
  canShareDescription,
  connectionChannel,
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
  "terminal.profile.use",
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
  "approval.other",
];
const FULL_ACCESS = [...DEVELOPER, "terminal.use", "workspace.manage"];
const LEVELS = {
  daemon: {
    connect: ["daemon.connect"],
    developer: ["daemon.connect", ...DEVELOPER],
    full_access: ["daemon.connect", ...FULL_ACCESS, "hub.access.manage"],
  },
  project: { office_worker: OFFICE_WORKER, developer: DEVELOPER },
  team: { admin: ["hub.access.manage"] },
  channel_account: { manage: ["channel.manage", "hub.access.manage"] },
  automation: { run: ["automation.run"], admin: ["automation.run", "hub.access.manage"] },
};

describe("summarizeAccess", () => {
  it("tells Office worker what it leaves out", () => {
    const summary = summarizeAccess({ privileges: OFFICE_WORKER, resourceKind: "project" });
    expect(summary.allows).toContain("Approve file edits");
    expect(summary.withholds).toEqual([
      "No shell",
      "Cannot approve shell commands",
      "Cannot create workspaces or worktrees",
      "Cannot create, rename, or remove Projects",
    ]);
    expect(summary.cautions).toEqual([]);
  });

  it("separates Developer from Full access by the shell and Project management", () => {
    const developer = summarizeAccess({ privileges: DEVELOPER, resourceKind: "project" });
    expect(developer.allows).toContain("Run agents without asking for approval");
    expect(developer.allows).toContain("Open the chosen Terminal profiles");
    expect(developer.withholds).toEqual(["No shell", "Cannot create, rename, or remove Projects"]);
    expect(
      accessChanges({ before: DEVELOPER, after: FULL_ACCESS, resourceKind: "project" }),
    ).toEqual({
      added: [
        "Open a shell and run any command",
        "Rename, remove, or archive this Project and its workspaces and worktrees",
      ],
      removed: ["Open the chosen Terminal profiles"],
    });
  });

  it("says a Host grant reaches every Project and creates where the Host allows", () => {
    const summary = summarizeAccess({
      privileges: ["daemon.connect", ...FULL_ACCESS],
      resourceKind: "daemon",
    });
    expect(summary.allows).toContain(
      "Use every Project on this Host, including Projects added later",
    );
    expect(summary.allows).toContain("Create Projects where this Host allows");
    expect(summary.cautions).toContain(
      "Any folder this Host's Project folder policy allows can become a Project",
    );
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
      "Open the chosen Terminal profiles",
      "Approve every action, destructive commands included",
      "Run agents without asking for approval",
    ]);
  });
});

describe("level names", () => {
  it("describes Full access by where it is granted", () => {
    expect(accessLevelDescription("full_access", "daemon")).toContain("where this Host allows");
    expect(accessLevelDescription("full_access", "project")).toContain("this Project");
    expect(accessLevelDescription("future_level", "project")).toBeUndefined();
  });

  it("matches a saved grant to its level, ignoring Fast mode", () => {
    expect(matchingAccessLevel(LEVELS, "project", [...DEVELOPER, "agent.fast.use"])).toBe(
      "developer",
    );
    expect(matchingAccessLevel(LEVELS, "project", ["project.use"])).toBeUndefined();
    expect(matchingAccessLevel(LEVELS, "channel_account", ["channel.use"])).toBeUndefined();
    expect(
      matchingAccessLevel(LEVELS, "channel_account", ["channel.manage", "hub.access.manage"]),
    ).toBe("manage");
    expect(
      summarizeAccess({
        privileges: ["channel.manage", "hub.access.manage"],
        resourceKind: "channel_account",
      }).allows,
    ).toContain("Appoint another Admin on this Connection");
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

describe("Connection Admin", () => {
  const ADMIN = ["channel.manage", "hub.access.manage"];

  it("offers QR relogin only on a QR-login channel", () => {
    const relogin = "Log the account back in by QR scan when its session expires";
    expect(
      summarizeAccess({ privileges: ADMIN, resourceKind: "channel_account" }).allows,
    ).not.toContain(relogin);
    expect(
      summarizeAccess({ privileges: ADMIN, resourceKind: "channel_account", qrLogin: true }).allows,
    ).toContain(relogin);
  });

  it("states the delegation limit and what Admin does not include", () => {
    const summary = summarizeAccess({ privileges: ADMIN, resourceKind: "channel_account" });
    expect(summary.cautions.join("\n")).toContain("their own Host and Project access");
    expect(summary.withholds.join("\n")).toContain("bot token");
    expect(summary.withholds.join("\n")).toContain("audience rules decide who the bot answers");
  });

  it("reads the channel from a Connection resource id", () => {
    expect(connectionChannel("zalouser/abc%2F1")).toBe("zalouser");
    expect(connectionChannel("no-separator")).toBeUndefined();
  });
});
