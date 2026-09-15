import { APIError } from "better-call";
import { ORGANIZATION_PROFILE_ERROR_CODES } from "./registration-contract.js";

/** Better Auth's organization endpoint; Hub lets owners rename their organization through it. */
export const UPDATE_ORGANIZATION_PATH = "/api/auth/organization/update";

const NAME_MAX_LENGTH = 100;

interface OrganizationUpdate {
  organization: Record<string, unknown>;
  member: { role: string };
}

/**
 * `organizationHooks.beforeUpdateOrganization`: only an owner changes the organization, and only
 * its display name. The slug stays fixed because daemon handoff and CLI flows address the
 * organization by it; logo and metadata have no Hub surface.
 */
export async function beforeUpdateOrganization({ organization, member }: OrganizationUpdate) {
  if (member.role !== "owner") throw rejection(ORGANIZATION_PROFILE_ERROR_CODES.ownerRequired);
  const fields = Object.keys(organization).filter((key) => organization[key] !== undefined);
  if (fields.some((field) => field !== "name")) {
    throw rejection(ORGANIZATION_PROFILE_ERROR_CODES.fieldNotEditable);
  }
  const value = organization["name"];
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length === 0 || name.length > NAME_MAX_LENGTH || hasControlCharacter(name)) {
    throw rejection(ORGANIZATION_PROFILE_ERROR_CODES.invalidName);
  }
  return { data: { name } };
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function rejection(code: string): APIError {
  return new APIError(
    code === ORGANIZATION_PROFILE_ERROR_CODES.ownerRequired ? "FORBIDDEN" : "BAD_REQUEST",
    {
      message: code,
      code,
    },
  );
}
