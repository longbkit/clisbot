import type { SelectFieldOption } from "@/components/ui/select-field";
import { capitalizeLabel } from "../labels";
import type { HubCapabilities, HubMember } from "./types";

export type OrganizationRole = HubMember["role"];

const ROLE_ORDER: OrganizationRole[] = ["member", "admin", "owner"];

/** The roles the viewer may set: Owner only when the Hub lets them manage Owners. */
export function memberRoleOptions(
  capabilities: HubCapabilities | undefined,
): SelectFieldOption<OrganizationRole>[] {
  return ROLE_ORDER.filter((role) => role !== "owner" || capabilities?.manageOwners === true).map(
    (role) => ({ id: role, value: role, label: capitalizeLabel(role) }),
  );
}

/**
 * Why the viewer cannot change this Member's role, or null when they can. The Hub enforces the
 * same rules (403 for an Admin touching an Owner, `last_owner_required` for the last Owner); the
 * hint says so before the request is sent.
 */
export function memberRoleLockReason(
  member: HubMember,
  members: readonly HubMember[],
  capabilities: HubCapabilities | undefined,
): string | null {
  if (capabilities?.manageMembers !== true) return "Only Owners and Admins change roles.";
  if (member.role !== "owner") return null;
  if (capabilities.manageOwners !== true) return "Only an Owner changes an Owner's role.";
  const owners = members.filter(({ role }) => role === "owner").length;
  return owners <= 1 ? "The last Owner cannot step down." : null;
}

/**
 * Why the viewer cannot remove this Member, or null when they can. Mirrors the Hub
 * (`canRemoveMember` and `protectLastOwner`): an Admin cannot remove an Owner, and the last
 * Owner cannot be removed.
 */
export function memberRemoveLockReason(
  member: HubMember,
  members: readonly HubMember[],
  capabilities: HubCapabilities | undefined,
): string | null {
  if (capabilities?.manageMembers !== true) return "Only Owners and Admins remove Members.";
  if (member.role !== "owner") return null;
  if (capabilities.manageOwners !== true) return "Only an Owner removes an Owner.";
  const owners = members.filter(({ role }) => role === "owner").length;
  return owners <= 1 ? "The last Owner cannot be removed." : null;
}

/** The Owner change needs a confirmation; every other role change is immediate. */
export function roleChangeConfirmation(
  member: HubMember,
  role: OrganizationRole,
): { title: string; message: string; confirmLabel: string } | null {
  if (role !== "owner") return null;
  return {
    title: `Make ${member.name} an Owner?`,
    message:
      "Owners have full access to every Host, Project, Channel, and Automation, and can change every role, including yours.",
    confirmLabel: "Make Owner",
  };
}

/** The Hub's refusal, worded for the role dropdown. */
export function roleChangeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("last_owner_required")) return "The last Owner cannot step down.";
  if (message.includes("(403)")) return "Only an Owner changes an Owner's role.";
  return message.length > 0 ? message : "Hub request failed.";
}
