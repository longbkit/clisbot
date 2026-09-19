import { describe, expect, it } from "vitest";
import type { AccessAssignment, AccessResource } from "./access-catalog";
import { describeAccessEvent, revocableAdministratorGrant } from "./access-events-section";
import type { ViewerAuthority } from "./access-grantor";

const resources = [
  { kind: "daemon", id: "host", name: "Build box", available: true, parent: null },
  { kind: "automation", id: "nightly", name: "Nightly", available: true, parent: null },
] as AccessResource[];
const administrator = {
  id: "grant",
  subjectKind: "member",
  subjectId: "m-ana",
  resourceKind: "daemon",
  resourceId: "host",
  privileges: ["daemon.connect", "daemon.manage", "hub.access.manage"],
  constraints: {},
} as unknown as AccessAssignment;
const granted = {
  id: "event",
  organizationId: "org",
  kind: "administrator_granted" as const,
  resourceKind: "daemon" as const,
  resourceId: "host",
  subjectKind: "member" as const,
  subjectId: "m-ana",
  actorUserId: "u-bo",
  createdAt: "2026-09-19T00:00:00.000Z",
};
const context = {
  resources,
  assignments: [administrator],
  authority: { unrestricted: true } as ViewerAuthority,
  memberNameByUserId: new Map([["u-bo", "Bo"]]),
  teamById: new Map<string, string>(),
  memberById: new Map([["m-ana", "Ana"]]),
};

describe("access events", () => {
  it("words each kind as what happened, not every event as an Administrator grant", () => {
    expect(describeAccessEvent(granted, context)).toBe(
      "Bo granted Administrator on Build box to Ana",
    );
    const paused = {
      ...granted,
      kind: "automation_paused" as const,
      resourceKind: "automation" as const,
      resourceId: "nightly",
      actorUserId: null,
    };
    expect(describeAccessEvent(paused, context)).toBe(
      "Hub paused Automation Nightly: its author Ana lost access to a target",
    );
    expect(revocableAdministratorGrant(paused, context)).toBeUndefined();
  });

  it("offers Revoke only while the grant still holds Administrator and the viewer may remove it", () => {
    expect(revocableAdministratorGrant(granted, context)?.id).toBe("grant");
    const downgraded = { ...administrator, privileges: ["daemon.connect"] };
    expect(
      revocableAdministratorGrant(granted, { ...context, assignments: [downgraded] }),
    ).toBeUndefined();
    const member: ViewerAuthority = { unrestricted: false, grants: [] };
    expect(revocableAdministratorGrant(granted, { ...context, authority: member })).toBeUndefined();
  });
});
