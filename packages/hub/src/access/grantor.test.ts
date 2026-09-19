import { describe, expect, it } from "vitest";
import { RESOURCE_ACCESS_LEVELS, impliedPrivileges, type AccessPrivilege } from "./contract.js";
import { canShareResource, decideGrant, type GrantActor, type GrantDecision } from "./grantor.js";
import type { AccessAssignmentRecord, AccessResourceRecord } from "./store.js";

const HOST = "daemon-1";
const PROJECT = "project-1";
const TEAM = "team-1";
const organization = { kind: "organization" as const, id: "org" };
const resources: AccessResourceRecord[] = [
  { kind: "organization", id: "org", name: "Org", parent: null, available: true },
  { kind: "daemon", id: HOST, name: "Host", parent: organization, available: true },
  {
    kind: "project",
    id: PROJECT,
    name: "Project",
    parent: { kind: "daemon", id: HOST },
    available: true,
  },
  { kind: "team", id: TEAM, name: "QC", parent: organization, available: true },
];

function grant(
  resourceKind: AccessAssignmentRecord["resourceKind"],
  resourceId: string,
  privileges: readonly AccessPrivilege[],
  constraints: AccessAssignmentRecord["constraints"] = {},
): AccessAssignmentRecord {
  return {
    id: `${resourceKind}:${resourceId}`,
    organizationId: "org",
    subjectKind: "member",
    subjectId: "me",
    resourceKind,
    resourceId,
    privileges: [...privileges],
    constraints,
    createdByUserId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const codex = { providerId: "codex", modelIds: ["gpt-5.6-luna"], thinkingOptionIds: "*" as const };
const anyCodex = { providerId: "codex", modelIds: "*" as const, thinkingOptionIds: "*" as const };
const developerWhoShares: GrantActor = {
  role: "member",
  assignments: [
    grant("daemon", HOST, [...RESOURCE_ACCESS_LEVELS.daemon.developer, "hub.access.manage"], {
      agentConfigurations: [codex],
    }),
  ],
};

function refusal(decision: GrantDecision): string {
  if (decision.allowed) throw new Error("expected a refusal");
  return decision.reason;
}

describe("decideGrant", () => {
  it("lets Organization Owners and Admins grant without holding a row", () => {
    const candidate = {
      resourceKind: "daemon" as const,
      resourceId: HOST,
      privileges: [...RESOURCE_ACCESS_LEVELS.daemon.administrator],
      constraints: {},
    };
    expect(decideGrant({ role: "admin", assignments: [] }, candidate, resources)).toEqual({
      allowed: true,
    });
    expect(decideGrant({ role: "owner", assignments: [] }, candidate, resources)).toEqual({
      allowed: true,
    });
    expect(decideGrant({ role: "member", assignments: [] }, candidate, resources)).toMatchObject({
      allowed: false,
    });
  });

  it("allows a grant within the actor's own level and refuses one above it", () => {
    const withinLevel = {
      resourceKind: "daemon" as const,
      resourceId: HOST,
      privileges: [...RESOURCE_ACCESS_LEVELS.daemon.office_worker],
      constraints: { agentConfigurations: [codex] },
    };
    expect(decideGrant(developerWhoShares, withinLevel, resources)).toEqual({ allowed: true });
    const aboveLevel = {
      ...withinLevel,
      privileges: [...RESOURCE_ACCESS_LEVELS.daemon.full_access],
    };
    expect(refusal(decideGrant(developerWhoShares, aboveLevel, resources))).toContain(
      "workspace.manage",
    );
  });

  it("requires Can share on the resource even for a grant at the actor's own level", () => {
    const developer: GrantActor = {
      role: "member",
      assignments: [
        grant("daemon", HOST, RESOURCE_ACCESS_LEVELS.daemon.developer, {
          agentConfigurations: [codex],
        }),
      ],
    };
    const candidate = {
      resourceKind: "daemon" as const,
      resourceId: HOST,
      privileges: [...RESOURCE_ACCESS_LEVELS.daemon.connect],
      constraints: {},
    };
    expect(decideGrant(developer, candidate, resources)).toMatchObject({ allowed: false });
    expect(canShareResource(developer, resources[1]!, resources)).toBe(false);
    expect(canShareResource(developerWhoShares, resources[1]!, resources)).toBe(true);
  });

  it("reaches a Project through the Host grant that fans out to it", () => {
    const candidate = {
      resourceKind: "project" as const,
      resourceId: PROJECT,
      privileges: [...RESOURCE_ACCESS_LEVELS.project.office_worker],
      constraints: { agentConfigurations: [codex] },
    };
    expect(decideGrant(developerWhoShares, candidate, resources)).toEqual({ allowed: true });
    expect(canShareResource(developerWhoShares, resources[2]!, resources)).toBe(true);
    // A Project grant never reaches its Host or another resource.
    const projectOnly: GrantActor = {
      role: "member",
      assignments: [
        grant("project", PROJECT, [...RESOURCE_ACCESS_LEVELS.project.full_access], {
          agentConfigurations: [anyCodex],
        }),
      ],
    };
    expect(canShareResource(projectOnly, resources[1]!, resources)).toBe(false);
    expect(canShareResource(projectOnly, resources[3]!, resources)).toBe(false);
    // ...except the Connect-only Host row a Project grant needs to mint a ticket.
    const connectOnly = {
      resourceKind: "daemon" as const,
      resourceId: HOST,
      privileges: ["daemon.connect" as const],
      constraints: {},
    };
    expect(decideGrant(projectOnly, connectOnly, resources)).toEqual({ allowed: true });
    expect(
      decideGrant(
        projectOnly,
        { ...connectOnly, privileges: ["daemon.connect", "project.use"] },
        resources,
      ).allowed,
    ).toBe(false);
  });

  it("keeps Agent configurations and conversations within the actor's own", () => {
    const widerModels = {
      resourceKind: "daemon" as const,
      resourceId: HOST,
      privileges: [...RESOURCE_ACCESS_LEVELS.daemon.office_worker],
      constraints: { agentConfigurations: [anyCodex] },
    };
    expect(refusal(decideGrant(developerWhoShares, widerModels, resources))).toContain(
      "Agent configurations",
    );
    const routeAdmin: GrantActor = {
      role: "member",
      assignments: [
        grant("channel_account", "slack/support", ["hub.access.manage", "channel.use"], {
          conversation: { kind: "specific", conversationIds: ["C1"] },
        }),
      ],
    };
    const inside = {
      resourceKind: "channel_account" as const,
      resourceId: "slack/support",
      privileges: ["channel.use" as const],
      constraints: { conversation: { kind: "specific" as const, conversationIds: ["C1"] } },
    };
    expect(decideGrant(routeAdmin, inside, resources)).toEqual({ allowed: true });
    const outside = { ...inside, constraints: { conversation: { kind: "all" as const } } };
    expect(decideGrant(routeAdmin, outside, resources)).toMatchObject({ allowed: false });
  });

  it("lets a Channel Route Admin appoint another Admin on that account only", () => {
    const all = { conversation: { kind: "all" as const } };
    const routeAdmin: GrantActor = {
      role: "member",
      assignments: [
        grant(
          "channel_account",
          "slack/support",
          impliedPrivileges("channel_account", ["channel.manage"]),
          all,
        ),
      ],
    };
    const appoint = {
      resourceKind: "channel_account" as const,
      resourceId: "slack/support",
      privileges: [...RESOURCE_ACCESS_LEVELS.channel_account.manage],
      constraints: all,
    };
    expect(decideGrant(routeAdmin, appoint, resources)).toEqual({ allowed: true });
    expect(
      decideGrant(routeAdmin, { ...appoint, resourceId: "slack/other" }, resources),
    ).toMatchObject({ allowed: false });
  });

  it("treats Full access and Administrator as sharing, and Team Admin as scoped to the Team", () => {
    expect(impliedPrivileges("daemon", ["daemon.connect", "daemon.manage"])).toContain(
      "hub.access.manage",
    );
    expect(impliedPrivileges("project", ["project.use", "workspace.manage"])).toContain(
      "hub.access.manage",
    );
    expect(impliedPrivileges("daemon", [...RESOURCE_ACCESS_LEVELS.daemon.developer])).not.toContain(
      "hub.access.manage",
    );
    // A Channel Route Admin row written before the level carried hub.access.manage reads as Admin.
    expect(impliedPrivileges("channel_account", ["channel.manage"])).toContain("hub.access.manage");
    const administrator: GrantActor = {
      role: "member",
      assignments: [
        grant("daemon", HOST, impliedPrivileges("daemon", ["daemon.connect", "daemon.manage"])),
      ],
    };
    // Administrator has no Agent ceiling, so any configuration is within it.
    expect(
      decideGrant(
        administrator,
        {
          resourceKind: "daemon",
          resourceId: HOST,
          privileges: [...RESOURCE_ACCESS_LEVELS.daemon.administrator],
          constraints: {},
        },
        resources,
      ),
    ).toEqual({ allowed: true });
    const teamAdmin: GrantActor = {
      role: "member",
      assignments: [grant("team", TEAM, RESOURCE_ACCESS_LEVELS.team.admin)],
    };
    expect(
      decideGrant(
        teamAdmin,
        {
          resourceKind: "team",
          resourceId: TEAM,
          privileges: ["hub.access.manage"],
          constraints: {},
        },
        resources,
      ),
    ).toEqual({ allowed: true });
    expect(
      decideGrant(
        teamAdmin,
        {
          resourceKind: "daemon",
          resourceId: HOST,
          privileges: ["daemon.connect"],
          constraints: {},
        },
        resources,
      ),
    ).toMatchObject({ allowed: false });
  });
});
