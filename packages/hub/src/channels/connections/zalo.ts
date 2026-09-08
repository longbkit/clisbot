// COMPAT(clisbot-channels): the Zalo Official Bot Connection — probe the token
// for its bot identity, then store it (with the webhook secret, when the
// operator supplies one) in the Hub's encrypted `zalo_connections` owner.
//
// The probe restates the vertical's `packages/channels/zalo/src/probe.ts`:
// `POST https://bot-api.zaloplatforms.com/bot<token>/getMe`, whose `{ok: true,
// result: {id, account_name, …}}` body is the bot identity. It is restated
// rather than imported because Hub production code never imports a channel
// vertical, and `zalo.test.ts` pins the two implementations to the same answers
// on the same responses.
//
// The token is never logged, never returned, and never put in an error message —
// note that Zalo carries it in the URL PATH, so no probe failure may echo a URL.

import type { ChannelBotIdentity, Database } from "../../db/types.js";
import {
  ChannelCredentialProbeError,
  probeFetch,
  probeJson,
  readRecord,
  readString,
} from "./probe.js";

const ZALO_API_BASE = "https://bot-api.zaloplatforms.com";

/** Upstream's own bound: 8-256 chars (`start-account.ts` refuses anything else). */
const WEBHOOK_SECRET_MIN = 8;
const WEBHOOK_SECRET_MAX = 256;

/** `POST /bot<token>/getMe` — the bot identity behind a Zalo Bot API token. */
export async function probeZaloBotToken(token: string): Promise<ChannelBotIdentity> {
  const normalized = token.trim();
  if (normalized === "") {
    throw new ChannelCredentialProbeError("the Zalo bot token is empty", true);
  }
  const response = await probeFetch("Zalo", `${ZALO_API_BASE}/bot${normalized}/getMe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new ChannelCredentialProbeError("Zalo rejected the bot token", true);
  }
  if (!response.ok) {
    throw new ChannelCredentialProbeError(`the Zalo API answered ${response.status}`, false);
  }
  const body: unknown = await probeJson(response);
  // The Bot API answers 200 with `{ok: false, description}` for a bad token as
  // readily as it answers 401, so the envelope decides, not the status.
  if (Reflect.get(body ?? {}, "ok") !== true) {
    throw new ChannelCredentialProbeError(
      readString(body, "description") ?? "Zalo rejected the bot token",
      true,
    );
  }
  const result = readRecord(body, "result");
  const id = result === undefined ? undefined : readString(result, "id");
  if (id === undefined) {
    throw new ChannelCredentialProbeError("the Zalo API returned no bot identity", false);
  }
  const username = readString(result, "account_name");
  return {
    id,
    ...(username === undefined ? {} : { username }),
    probedAt: new Date().toISOString(),
  };
}

/** Probe the token, then upsert the organization's Zalo Connection. */
export async function configureZaloConnection(
  database: Database,
  input: {
    organizationId: string;
    accountId: string;
    botToken: string;
    /** Webhook mode only; Zalo echoes it in `x-bot-api-secret-token`. */
    webhookSecret?: string | undefined;
  },
): Promise<{ connectionId: string; identity: ChannelBotIdentity }> {
  const webhookSecret = input.webhookSecret?.trim();
  if (
    webhookSecret !== undefined &&
    (webhookSecret.length < WEBHOOK_SECRET_MIN || webhookSecret.length > WEBHOOK_SECRET_MAX)
  ) {
    throw new ChannelCredentialProbeError(
      `the Zalo webhook secret must be ${WEBHOOK_SECRET_MIN}-${WEBHOOK_SECRET_MAX} characters`,
      true,
    );
  }
  const identity = await probeZaloBotToken(input.botToken);
  const { connectionId } = await database.configureChannelConnection({
    organizationId: input.organizationId,
    channel: "zalo",
    accountId: input.accountId,
    credentials: {
      botToken: input.botToken.trim(),
      ...(webhookSecret === undefined || webhookSecret === "" ? {} : { webhookSecret }),
    },
    identity,
  });
  return { connectionId, identity };
}
