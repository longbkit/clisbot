import { describe, expect, it } from "vitest";
import { memberRemoveLockReason } from "./member-role";
import {
  administeredTeamIds,
  canInvitePeople,
  canManageTeamMembership,
  canSeeInvitations,
  invitableTeams,
  inviteRoleLocked,
  visibleTeams,
} from "./team-membership";
import type { HubCapabilities, PeopleAuthority } from "./types";

const ADMIN: HubCapabilities = {
  view: true,
  manageMembers: true,
  manageOwners: false,
  manageResources: true,
};
const OWNER: HubCapabilities = { ...ADMIN, manageOwners: true };
const MEMBER: HubCapabilities = {
  view: true,
  manageMembers: false,
  manageOwners: false,
  manageResources: false,
};
const qc = { id: "t-qc", name: "QC", userIds: ["u-lead"], createdAt: "", updatedAt: "" };
const ops = { id: "t-ops", name: "Ops", userIds: ["u-lead"], createdAt: "", updatedAt: "" };
const design = { id: "t-design", name: "Design", userIds: ["u-x"], createdAt: "", updatedAt: "" };
const teams = [qc, ops, design];

const organizationAdmin: PeopleAuthority = { capabilities: ADMIN, administeredTeamIds: new Set() };
const teamAdmin: PeopleAuthority = { capabilities: MEMBER, administeredTeamIds: new Set(["t-qc"]) };
const member: PeopleAuthority = { capabilities: MEMBER, administeredTeamIds: new Set() };

function grant(kind: "team" | "daemon", id: string, privileges: string[]) {
  return {
    assignmentId: `${kind}-${id}`,
    resource: { kind, id, name: id, parent: null, available: true },
    privileges,
    constraints: {},
    source: { kind: "direct" as const },
  };
}

describe("administeredTeamIds", () => {
  it("reads Team Admin grants only", () => {
    const ids = administeredTeamIds({
      owner: false,
      grants: [
        grant("team", "t-qc", ["hub.access.manage"]),
        grant("daemon", "host", ["hub.access.manage"]),
      ],
    });
    expect([...ids]).toEqual(["t-qc"]);
    expect(administeredTeamIds(undefined).size).toBe(0);
  });
});

describe("Team Admin authority", () => {
  it("manages and invites into their own Team only", () => {
    expect(canManageTeamMembership(teamAdmin, "t-qc")).toBe(true);
    expect(canManageTeamMembership(teamAdmin, "t-design")).toBe(false);
    expect(canInvitePeople(teamAdmin, "t-qc")).toBe(true);
    expect(canInvitePeople(teamAdmin, "t-design")).toBe(false);
    expect(canInvitePeople(teamAdmin)).toBe(true);
    expect(canInvitePeople(member)).toBe(false);
    expect(canInvitePeople(organizationAdmin, "t-design")).toBe(true);
  });

  it("offers only administered Teams and locks the role to Member", () => {
    expect(invitableTeams(teamAdmin, teams)).toEqual([qc]);
    expect(invitableTeams(organizationAdmin, teams)).toEqual(teams);
    expect(inviteRoleLocked(teamAdmin)).toBe(true);
    expect(inviteRoleLocked(organizationAdmin)).toBe(false);
    expect(canSeeInvitations(teamAdmin)).toBe(true);
    expect(canSeeInvitations(member)).toBe(false);
  });

  it("shows everyone but Organization Admins only the Teams they belong to or administer", () => {
    expect(visibleTeams(organizationAdmin, teams, "u-lead")).toEqual(teams);
    expect(visibleTeams(member, teams, "u-lead")).toEqual([qc, ops]);
    expect(
      visibleTeams({ ...teamAdmin, administeredTeamIds: new Set(["t-design"]) }, teams, "u-x"),
    ).toEqual([design]);
  });
});

describe("memberRemoveLockReason", () => {
  const owner = { id: "m-o", userId: "u-o", name: "O", email: "o@x", role: "owner" as const };
  const other = { ...owner, id: "m-o2", userId: "u-o2" };
  const plain = { ...owner, id: "m-p", userId: "u-p", role: "member" as const };

  it("follows the Hub: Admins cannot remove Owners, nobody removes the last Owner", () => {
    expect(memberRemoveLockReason(plain, [owner, plain], ADMIN)).toBeNull();
    expect(memberRemoveLockReason(owner, [owner, other], ADMIN)).toBe(
      "Only an Owner removes an Owner.",
    );
    expect(memberRemoveLockReason(owner, [owner, other], OWNER)).toBeNull();
    expect(memberRemoveLockReason(owner, [owner, plain], OWNER)).toBe(
      "The last Owner cannot be removed.",
    );
    expect(memberRemoveLockReason(plain, [owner, plain], MEMBER)).not.toBeNull();
  });
});
