// The AAD owner of every encrypted Hub column. A row only opens under the owner
// it was sealed with, so the stores that read and write a column and the boot
// re-seal (`credential-reseal.ts`) must build it from this one place.

import type {
  ChannelConnectionChannel,
  ChannelStateSecretScope,
  ConnectionProvider,
} from "../db/types.js";
import type { CredentialEnvelopeVersion } from "./credential-cipher.js";

export const RUNTIME_AUTH_SECRET_OWNER = "runtime-configuration:auth-secret";

export function providerApplicationCredentialOwner(
  provider: ConnectionProvider,
  applicationId: string,
): string {
  return `provider-application:${provider}:${applicationId}`;
}

export function connectionAttemptCredentialOwner(input: {
  provider: ConnectionProvider;
  providerApplicationId: string | null;
  configurationVersion: number;
}): string {
  if (input.providerApplicationId === null)
    throw new Error("connection attempt has no application");
  return `connection-attempt:${input.provider}:${input.providerApplicationId}:${input.configurationVersion}`;
}

export function slackConnectionCredentialOwner(applicationId: string, teamId: string): string {
  return `slack-connection:${applicationId}:${teamId}`;
}

export function linearConnectionCredentialOwner(
  applicationId: string,
  linearOrganizationId: string,
): string {
  return `linear-connection:${applicationId}:${linearOrganizationId}`;
}

/** One owner per Connection row. Binding the organization means a row lifted into
 * another organization fails authentication instead of decrypting; v1 rows predate
 * that binding (before 2026-09-07) and every later version carries it. */
export function channelCredentialOwner(
  channel: ChannelConnectionChannel,
  connectionId: string,
  organizationId: string,
  version: CredentialEnvelopeVersion,
): string {
  return version === 1
    ? `${channel}-connection:${connectionId}`
    : `${channel}-connection:${organizationId}:${connectionId}`;
}

/** The AAD owner of one encrypted keyed-store namespace. Binding the whole
 * scope means a row lifted into another organization, account or namespace
 * fails authentication instead of decrypting. */
export function channelStateSecretOwner(scope: ChannelStateSecretScope, namespace: string): string {
  return `channel-state:${scope.channel}:${scope.organizationId}:${scope.accountId}:${namespace}`;
}
