import { invitationRoleSchema, type InvitationRole } from "./organization-contract.js";

export function invitationRole(data: FormData): InvitationRole {
  return invitationRoleSchema.parse(formValue(data, "role"));
}

export function formValue(data: FormData, name: string): string {
  const value = data.get(name);
  if (typeof value !== "string") throw new Error(`form field is missing: ${name}`);
  return value;
}
