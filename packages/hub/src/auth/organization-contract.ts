import { z } from "zod";
import { REGISTRATION_MODES } from "./instance-policy.js";

export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;
export const INVITATION_ROLES = ["admin", "member"] as const;

export const organizationRoleSchema = z.enum(ORGANIZATION_ROLES);
export const invitationRoleSchema = z.enum(INVITATION_ROLES);

const accountSchema = z.object({ id: z.string(), name: z.string(), email: z.string() });
const membershipSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  membershipId: z.string(),
  role: organizationRoleSchema,
});
const invitationSchema = z.object({
  id: z.string(),
  organization: z.object({ id: z.string(), name: z.string() }),
  inviterName: z.string(),
  role: invitationRoleSchema,
  expiresAt: z.string(),
  email: z.string().email().optional(),
});
const teamMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: organizationRoleSchema,
});
const managerInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: invitationRoleSchema,
  expiresAt: z.string(),
  link: z.string().url(),
});

export const organizationCapabilitiesSchema = z.object({
  view: z.literal(true),
  manageMembers: z.boolean(),
  manageOwners: z.boolean(),
  manageResources: z.boolean(),
});

export const accountStateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("instanceSetupRequired"),
  }),
  z.object({
    status: z.literal("signedOut"),
    registration: z.enum(REGISTRATION_MODES),
    invitation: invitationSchema.optional(),
    invitationUnavailable: z.literal(true).optional(),
  }),
  z.object({
    status: z.literal("passwordChangeRequired"),
    account: accountSchema,
  }),
  z.object({
    status: z.literal("appSetupRequired"),
    account: accountSchema,
    // The same resolved membership the active state carries, slug included: the daemon handoff
    // that follows app setup addresses the organization by slug.
    organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    memberships: z.array(membershipSchema),
    capabilities: organizationCapabilitiesSchema,
  }),
  z.object({
    status: z.literal("organizationRequired"),
    account: accountSchema,
    memberships: z.array(membershipSchema),
    invitation: invitationSchema.optional(),
    invitationUnavailable: z.literal(true).optional(),
    canCreateOrganization: z.boolean(),
  }),
  z.object({
    status: z.literal("active"),
    account: accountSchema,
    memberships: z.array(membershipSchema),
    organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    membership: z.object({ id: z.string(), role: organizationRoleSchema }),
    capabilities: organizationCapabilitiesSchema,
    isInstanceOperator: z.boolean(),
    team: z.object({
      members: z.array(teamMemberSchema),
      invitations: z.array(managerInvitationSchema).optional(),
    }),
    invitation: invitationSchema.optional(),
    invitationUnavailable: z.literal(true).optional(),
    canCreateOrganization: z.boolean(),
  }),
]);

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
export type InvitationRole = z.infer<typeof invitationRoleSchema>;
export type OrganizationCapabilities = z.infer<typeof organizationCapabilitiesSchema>;
export type AccountState = z.infer<typeof accountStateSchema>;
export type ActiveAccountState = Extract<AccountState, { status: "active" }>;
export type TeamMember = ActiveAccountState["team"]["members"][number];
