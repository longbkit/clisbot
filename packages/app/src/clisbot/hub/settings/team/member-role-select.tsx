import { useCallback, useMemo } from "react";
import { SelectField } from "@/components/ui/select-field";
import { capitalizeLabel } from "../labels";
import { memberRoleLockReason, memberRoleOptions, type OrganizationRole } from "./member-role";
import type { HubCapabilities, HubMember } from "./types";

/**
 * The organization role as an inline dropdown. Locked, with the reason as its hint, when the
 * viewer cannot change it: an Admin looking at an Owner, or the last Owner.
 */
export function MemberRoleSelect({
  member,
  members,
  capabilities,
  pending,
  setRole,
}: {
  member: HubMember;
  members: readonly HubMember[];
  capabilities: HubCapabilities | undefined;
  pending: boolean;
  setRole(member: HubMember, role: OrganizationRole): Promise<void>;
}) {
  const options = useMemo(() => memberRoleOptions(capabilities), [capabilities]);
  const lockReason = memberRoleLockReason(member, members, capabilities);
  const display = useMemo(() => ({ label: capitalizeLabel(member.role) }), [member.role]);
  const change = useCallback(
    (role: OrganizationRole) => {
      if (role !== member.role) void setRole(member, role);
    },
    [member, setRole],
  );
  return (
    <SelectField
      size="sm"
      label="Role"
      value={member.role}
      selectedDisplay={display}
      options={options}
      onChange={change}
      placeholder="Role"
      emptyText="No roles are available."
      title={`Role of ${member.name}`}
      disabled={pending || lockReason !== null}
      hint={lockReason ?? undefined}
    />
  );
}
