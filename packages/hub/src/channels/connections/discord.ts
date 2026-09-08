// COMPAT(clisbot-channels): the Discord bot-token Connection — probe the token
// for its bot identity, then store it in the Hub's encrypted Channel Connection
// owner (`discord_bot_connections`). Both entry points into the Channel plane
// (the control-plane `channels add` op and the management-api `POST
// /connections`) go through `configureDiscordConnection`, so a stored Discord
// credential is always one that answered `GET /users/@me`.
//
// The probe restates the vertical's `packages/channels/discord/src/probe.ts`:
// `GET /users/@me` with `Authorization: Bot <token>` for the bot identity, and
// the application id decoded from the token's first segment
// (`parseApplicationIdFromToken`). It is restated rather than imported because
// the channel verticals are supply the loader resolves at runtime — Hub
// production code never imports one — and `discord.differential.test.ts` pins
// the two implementations to the same answers on the same responses.
//
// The token is never logged, never returned, and never put in an error message.

import type { ChannelBotIdentity, Database } from "../../db/types.js";
import { ChannelCredentialProbeError, probeFetch, probeJson, readString } from "./probe.js";

const DISCORD_API = "https://discord.com/api/v10";

/** The vertical's `stripDiscordBotPrefix` + trim, so a pasted `Bot <token>` works. */
function normalizeDiscordToken(token: string): string {
  return token.trim().replace(/^Bot\s+/iu, "");
}

/**
 * The application id Discord encodes in the token's first segment
 * (base64url of the decimal snowflake). Kept as a string: the ids exceed
 * `Number.MAX_SAFE_INTEGER`.
 */
export function parseDiscordApplicationId(token: string): string | undefined {
  const segment = normalizeDiscordToken(token).split(".")[0];
  if (segment === undefined || segment === "") return undefined;
  const decoded = Buffer.from(segment, "base64url").toString("utf8");
  return /^\d{5,}$/u.test(decoded) ? decoded : undefined;
}

/** `GET /users/@me` — the bot identity behind a bot token. */
export async function probeDiscordBotToken(token: string): Promise<ChannelBotIdentity> {
  const normalized = normalizeDiscordToken(token);
  if (normalized === "") {
    throw new ChannelCredentialProbeError("the Discord bot token is empty", true);
  }
  const response = await probeFetch("Discord", `${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bot ${normalized}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new ChannelCredentialProbeError("Discord rejected the bot token", true);
  }
  if (!response.ok) {
    throw new ChannelCredentialProbeError(`the Discord API answered ${response.status}`, false);
  }
  const body: unknown = await probeJson(response);
  const id = readString(body, "id");
  if (id === undefined) {
    throw new ChannelCredentialProbeError("the Discord API returned no bot identity", false);
  }
  const username = readString(body, "username");
  const applicationId = parseDiscordApplicationId(normalized);
  return {
    id,
    ...(username === undefined ? {} : { username }),
    ...(applicationId === undefined ? {} : { applicationId }),
    probedAt: new Date().toISOString(),
  };
}

/** Probe the token, then upsert the organization's Discord Connection. */
export async function configureDiscordConnection(
  database: Database,
  input: { organizationId: string; accountId: string; botToken: string },
): Promise<{ connectionId: string; identity: ChannelBotIdentity }> {
  const identity = await probeDiscordBotToken(input.botToken);
  const { connectionId } = await database.configureChannelConnection({
    organizationId: input.organizationId,
    channel: "discord",
    accountId: input.accountId,
    credentials: { botToken: normalizeDiscordToken(input.botToken) },
    identity,
  });
  return { connectionId, identity };
}
