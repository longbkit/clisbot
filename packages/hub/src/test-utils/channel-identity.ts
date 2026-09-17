import type { CredentialEnvelope } from "../credentials/credential-cipher.js";
import type { DrizzleHandle } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";

export const TEST_SLACK_TEAM_ID = "T0TEST";
export const TEST_SLACK_CONNECTION_ID = "00000000-0000-4000-8000-000000005100";

/**
 * A Slack Connection row, so a Channel identity has a workspace to resolve in.
 * The credential is never read by identity code, so it is a placeholder.
 */
export async function insertTestSlackConnection(
  database: DrizzleHandle,
  input: {
    organizationId: string;
    id?: string;
    teamId?: string;
    providerApplicationId?: string;
  },
): Promise<string> {
  const id = input.id ?? TEST_SLACK_CONNECTION_ID;
  const providerApplicationId = input.providerApplicationId ?? `A${id.slice(-6)}`;
  const teamId = input.teamId ?? TEST_SLACK_TEAM_ID;
  await database.insert(schema.slackConnections).values({
    id,
    organizationId: input.organizationId,
    teamId,
    providerApplicationId,
    slug: `slack-${providerApplicationId.toLowerCase()}-${teamId.toLowerCase()}`,
    teamName: "Test workspace",
    botUserId: "UBOT",
    credentialEnvelope: {} as CredentialEnvelope,
  });
  return id;
}
