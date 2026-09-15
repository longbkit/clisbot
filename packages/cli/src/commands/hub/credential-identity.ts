import type { ListResult } from "../../output/index.js";
import type { HubCredentialIdentity, HubHttpClient } from "./hub-client/index.js";
import { reportHubProgress, type HubReporter } from "./reporter.js";
import type { HubRow } from "./status-output.js";

export type CredentialIdentityReader = Pick<HubHttpClient, "describeCredential">;

/** The organization-scoped identity a Hub reports for a stored credential, or undefined when the
 * Hub cannot say (an older Hub, a revoked credential, or no network). Never blocks the caller. */
export async function readCredentialIdentity(
  reader: CredentialIdentityReader,
  origin: string,
  credential: string,
): Promise<HubCredentialIdentity | undefined> {
  try {
    return await reader.describeCredential(origin, credential);
  } catch {
    return undefined;
  }
}

export function reportCredentialIdentity(
  reporter: HubReporter,
  options: { json?: boolean },
  origin: string,
  identity: HubCredentialIdentity | undefined,
): void {
  if (identity === undefined) {
    reportHubProgress(
      reporter,
      options,
      `Hub ${origin} did not report which organization this credential belongs to.`,
    );
    return;
  }
  for (const line of identityLines(identity)) reportHubProgress(reporter, options, line);
}

export function identityLines(identity: HubCredentialIdentity): string[] {
  return [
    `Hub: ${identity.hub}`,
    `Account: ${identity.account === null ? "(API key)" : identity.account.email}`,
    `Organization: ${identity.organization.name} (${identity.organization.slug})`,
    `Role: ${identity.role ?? "no current membership"}`,
  ];
}

export interface IdentityFields {
  account: string | null;
  organization: string | null;
  role: string | null;
}

export function identityFields(identity: HubCredentialIdentity | undefined): IdentityFields {
  return {
    account: identity?.account?.email ?? null,
    organization: identity?.organization.name ?? null,
    role: identity?.role ?? null,
  };
}

/** Adds the credential's account, organization, and role to a daemon Hub status row. */
export function withCredentialIdentity(
  result: ListResult<HubRow>,
  identity: HubCredentialIdentity | undefined,
): ListResult<HubRow & IdentityFields> {
  const fields = identityFields(identity);
  return {
    type: "list",
    data: result.data.map((row) => ({ ...row, ...fields })),
    schema: {
      idField: "state",
      columns: [
        ...result.schema.columns.slice(0, 2),
        { header: "ORGANIZATION", field: "organization" },
        { header: "ACCOUNT", field: "account" },
        { header: "ROLE", field: "role" },
        ...result.schema.columns.slice(2),
      ],
    },
  };
}
