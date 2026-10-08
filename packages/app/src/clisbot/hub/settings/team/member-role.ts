import type { TFunction } from "i18next";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { i18n } from "@/i18n/i18next";
import type { HubCapabilities, HubMember } from "./types";

export type OrganizationRole = HubMember["role"];

const ROLE_ORDER: OrganizationRole[] = ["member", "admin", "owner"];

/** The role's name in the UI language: `member` → `Member`. Team and invitation roles are a subset. */
export function roleLabel(role: OrganizationRole, t: TFunction): string {
  switch (role) {
    case "owner":
      return t("hub.team.roles.owner");
    case "admin":
      return t("hub.team.roles.admin");
    case "member":
      return t("hub.team.roles.member");
  }
}

/** The roles the viewer may set: Owner only when the Hub lets them manage Owners. */
export function memberRoleOptions(
  capabilities: HubCapabilities | undefined,
  t: TFunction,
): SelectFieldOption<OrganizationRole>[] {
  return ROLE_ORDER.filter((role) => role !== "owner" || capabilities?.manageOwners === true).map(
    (role) => ({ id: role, value: role, label: roleLabel(role, t) }),
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
  if (capabilities?.manageMembers !== true) return i18n.t("hub.team.role.onlyManagersChange");
  if (member.role !== "owner") return null;
  if (capabilities.manageOwners !== true) return i18n.t("hub.team.role.onlyOwnerChangesOwner");
  const owners = members.filter(({ role }) => role === "owner").length;
  return owners <= 1 ? i18n.t("hub.team.role.lastOwnerStepDown") : null;
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
  if (capabilities?.manageMembers !== true) return i18n.t("hub.team.role.onlyManagersRemove");
  if (member.role !== "owner") return null;
  if (capabilities.manageOwners !== true) return i18n.t("hub.team.role.onlyOwnerRemovesOwner");
  const owners = members.filter(({ role }) => role === "owner").length;
  return owners <= 1 ? i18n.t("hub.team.role.lastOwnerRemove") : null;
}

/** The Owner change needs a confirmation; every other role change is immediate. */
export function roleChangeConfirmation(
  member: HubMember,
  role: OrganizationRole,
): { title: string; message: string; confirmLabel: string } | null {
  if (role !== "owner") return null;
  return {
    title: i18n.t("hub.team.role.makeOwner.title", { name: member.name }),
    message: i18n.t("hub.team.role.makeOwner.message"),
    confirmLabel: i18n.t("hub.team.role.makeOwner.confirm"),
  };
}

/** The Hub's refusal, worded for the role dropdown. */
export function roleChangeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("last_owner_required")) return i18n.t("hub.team.role.lastOwnerStepDown");
  if (message.includes("(403)")) return i18n.t("hub.team.role.onlyOwnerChangesOwner");
  return message.length > 0 ? message : i18n.t("hub.team.errors.requestFailed");
}
