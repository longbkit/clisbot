import { describe, expect, it } from "vitest";
import { HubAccountStateSchema } from "./contracts";

const membership = {
  id: "org-selected",
  name: "Selected organization",
  slug: "selected",
  membershipId: "membership-selected",
  role: "admin",
};
const legacySetup = {
  status: "appSetupRequired",
  account: { id: "account-1", name: "Operator", email: "operator@example.test" },
  organization: { id: membership.id, name: membership.name, slug: membership.slug },
  memberships: [
    { ...membership, id: "other-org", membershipId: "other-membership", role: "owner" },
    membership,
  ],
  capabilities: {
    view: true,
    manageMembers: true,
    manageOwners: false,
    manageResources: true,
  },
  isInstanceOperator: true,
};

describe("Hub app setup membership compatibility", () => {
  it("preserves the current explicit membership", () => {
    const current = {
      ...legacySetup,
      membership: { id: "membership-selected", role: "admin" },
    };
    expect(HubAccountStateSchema.parse(current)).toEqual(current);
  });

  it("normalizes the legacy response from the selected organization's membership", () => {
    const state = HubAccountStateSchema.parse(legacySetup);
    expect(state.status).toBe("appSetupRequired");
    if (state.status !== "appSetupRequired") throw new Error("Expected app setup state");
    expect(state.membership).toEqual({ id: "membership-selected", role: "admin" });
    expect(state.team).toBeUndefined();
    expect(state.canCreateOrganization).toBeUndefined();
  });

  it("retains optional signed-in Team and invitation context during provider setup", () => {
    const context = {
      team: {
        members: [
          {
            id: membership.membershipId,
            userId: "account-1",
            name: "Operator",
            email: "operator@example.test",
            role: "admin",
          },
        ],
        invitations: [],
      },
      canCreateOrganization: false,
      invitation: {
        id: "invite",
        organization: { id: "other-org", name: "Other" },
        inviterName: "Owner",
        role: "member",
        expiresAt: "2026-09-06T00:00:00Z",
      },
    };
    expect(HubAccountStateSchema.parse({ ...legacySetup, ...context })).toMatchObject(context);
    expect(
      HubAccountStateSchema.parse({ ...legacySetup, invitationUnavailable: true }),
    ).toMatchObject({ invitationUnavailable: true });
  });

  it.each([
    { memberships: [] },
    { memberships: [{ ...membership, id: "other-org" }] },
    { memberships: [membership, membership] },
    { memberships: [{ ...membership, membershipId: "" }] },
    { memberships: [{ ...membership, role: "operator" }] },
    { membership: { id: "other-membership", role: "admin" } },
    { membership: { id: "membership-selected", role: "owner" } },
    { membership: null },
  ])("rejects missing, ambiguous, or mismatched membership evidence: %j", (override) => {
    expect(HubAccountStateSchema.safeParse({ ...legacySetup, ...override }).success).toBe(false);
  });

  it("leaves unrelated account states unchanged", () => {
    const signedOut = { status: "signedOut", registration: "invite_only" };
    expect(HubAccountStateSchema.parse(signedOut)).toEqual(signedOut);
  });
});
