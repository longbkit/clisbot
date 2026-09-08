import { organization } from "better-auth/plugins";
import {
  INVITATION_ROLES,
  ORGANIZATION_ROLES,
  type InvitationRole,
  type OrganizationCapabilities,
  type OrganizationRole,
} from "./organization-contract.js";

export type { InvitationRole, OrganizationCapabilities, OrganizationRole };

const ROLE_CAPABILITIES = {
  owner: {
    view: true,
    manageMembers: true,
    manageOwners: true,
    manageResources: true,
    manageChannels: true,
  },
  admin: {
    view: true,
    manageMembers: true,
    manageOwners: false,
    manageResources: true,
    manageChannels: true,
  },
  member: {
    view: true,
    manageMembers: false,
    manageOwners: false,
    manageResources: false,
    manageChannels: false,
  },
} as const satisfies Record<OrganizationRole, OrganizationCapabilities>;

export function paseoOrganizationPlugin() {
  return organization({
    creatorRole: ORGANIZATION_ROLES[0],
    dynamicAccessControl: { enabled: false },
    // Team is the reusable member directory for access assignment subjects. BetterAuth owns
    // Team CRUD/membership; resource privileges deliberately remain a separate Hub policy.
    teams: { enabled: true },
  });
}

export function parseOrganizationRole(value: string): OrganizationRole | undefined {
  return ORGANIZATION_ROLES.find((role) => role === value);
}

export function parseInvitationRole(value: string): InvitationRole | undefined {
  return INVITATION_ROLES.find((role) => role === value);
}

export function capabilitiesFor(role: OrganizationRole): OrganizationCapabilities {
  return ROLE_CAPABILITIES[role];
}

export function canChangeMemberRole(
  actor: OrganizationRole,
  current: OrganizationRole,
  next: OrganizationRole,
): boolean {
  if (!capabilitiesFor(actor).manageMembers) return false;
  if (current === "owner" || next === "owner") return capabilitiesFor(actor).manageOwners;
  return true;
}

export function canRemoveMember(actor: OrganizationRole, target: OrganizationRole): boolean {
  if (!capabilitiesFor(actor).manageMembers) return false;
  return target !== "owner" || capabilitiesFor(actor).manageOwners;
}
