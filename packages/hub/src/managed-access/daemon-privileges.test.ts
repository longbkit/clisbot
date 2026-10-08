import { describe, expect, it } from "vitest";
import type { ResolvedDaemonAccess } from "../access/store.js";
import { daemonKnownPrivileges, limitAuthorityToDaemon } from "./daemon-privileges.js";

const member: ResolvedDaemonAccess = {
  principalId: "membership",
  organizationId: "org",
  daemonId: "daemon",
  owner: false,
  permissions: ["daemon.read", "workspace.read", "automation.manage"],
  resourceMode: "projects",
  projects: [
    {
      projectId: "project-a",
      privileges: ["project.use", "agent.interact", "schedule.manage"],
      agentConfigurations: [],
    },
  ],
  daemonPrivileges: ["schedule.manage"],
};

describe("issuing only privileges the daemon enforces", () => {
  it("leaves schedules out for a daemon that predates the header, with their permission", () => {
    const limited = limitAuthorityToDaemon(member, daemonKnownPrivileges(null));
    expect(limited.projects[0]?.privileges).toEqual(["project.use", "agent.interact"]);
    expect(limited.daemonPrivileges).toEqual([]);
    expect(limited.permissions).toEqual(["daemon.read", "workspace.read"]);
  });

  it("keeps what the daemon declares", () => {
    const header = "project.use,agent.interact,schedule.manage";
    expect(limitAuthorityToDaemon(member, daemonKnownPrivileges(header))).toEqual(member);
  });

  it("passes owners and Host admins through untouched", () => {
    const admin = { ...member, resourceMode: "daemon" as const, projects: [] };
    expect(limitAuthorityToDaemon(admin, daemonKnownPrivileges(null))).toBe(admin);
  });
});
