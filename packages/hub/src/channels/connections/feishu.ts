// COMPAT(clisbot-channels): the Feishu/Lark Connection — probe the custom-app
// credential for its bot identity, then store all four fields in the Hub's
// encrypted `feishu_connections` owner.
//
// Unlike the token-native channels the credential is FOUR fields: the app id and
// secret (both transports), plus the event-subscription verification token and
// encrypt key (webhook transport only). Only the first two are probeable — the
// other two are secrets Feishu echoes back at delivery time, never at an API.
//
// The probe restates the two calls the vertical's
// `packages/channels/feishu/src/probe.ts` makes through the Lark SDK:
// `POST /open-apis/auth/v3/tenant_access_token/internal` for a tenant token,
// then `GET /open-apis/bot/v3/info` for `{app_name, open_id}`. It is restated
// rather than imported because Hub production code never imports a channel
// vertical (and never wants the SDK's process-wide client cache in the Hub);
// `feishu.test.ts` pins the two implementations to the same answers on the same
// responses.
//
// No credential is logged, returned, or put in an error message.

import type { ChannelBotIdentity, Database } from "../../db/types.js";
import {
  ChannelCredentialProbeError,
  probeFetch,
  probeJson,
  readRecord,
  readString,
} from "./probe.js";

/** The two open-platform origins, under the vertical's own `domain` names. */
const FEISHU_ORIGINS = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
} as const;

export type FeishuDomain = keyof typeof FEISHU_ORIGINS;

export interface FeishuAppCredential {
  appId: string;
  appSecret: string;
  verificationToken?: string | undefined;
  encryptKey?: string | undefined;
  domain?: FeishuDomain | undefined;
}

/** Feishu answers 200 with a non-zero `code` for a bad credential, so the
 * envelope decides whether it was rejected — not the HTTP status. */
function requireOkEnvelope(body: unknown, response: Response, what: string): void {
  if (!response.ok) {
    throw new ChannelCredentialProbeError(
      `the Feishu API answered ${response.status} for ${what}`,
      false,
    );
  }
  const code = Reflect.get(body ?? {}, "code");
  if (code === 0) return;
  const message = readString(body, "msg") ?? `code ${String(code)}`;
  throw new ChannelCredentialProbeError(`Feishu rejected the app credential: ${message}`, true);
}

/** Mints a tenant access token; the app id + secret are the whole credential. */
async function mintTenantAccessToken(
  origin: string,
  credential: FeishuAppCredential,
): Promise<string> {
  const response = await probeFetch(
    "Feishu",
    `${origin}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: credential.appId, app_secret: credential.appSecret }),
    },
  );
  const body: unknown = await probeJson(response);
  requireOkEnvelope(body, response, "the tenant access token");
  const token = readString(body, "tenant_access_token");
  if (token === undefined) {
    throw new ChannelCredentialProbeError("Feishu returned no tenant access token", false);
  }
  return token;
}

/** The bot identity behind a Feishu custom-app credential. */
export async function probeFeishuApp(credential: FeishuAppCredential): Promise<ChannelBotIdentity> {
  if (credential.appId.trim() === "" || credential.appSecret.trim() === "") {
    throw new ChannelCredentialProbeError("missing credentials (appId, appSecret)", true);
  }
  const origin = FEISHU_ORIGINS[credential.domain ?? "feishu"];
  const token = await mintTenantAccessToken(origin, credential);
  const response = await probeFetch("Feishu", `${origin}/open-apis/bot/v3/info`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  const body: unknown = await probeJson(response);
  requireOkEnvelope(body, response, "the bot identity");
  // Upstream reads `bot` and falls back to `data.bot`; both shapes are live.
  const bot = readRecord(body, "bot") ?? readRecord(readRecord(body, "data"), "bot");
  const openId = bot === undefined ? undefined : readString(bot, "open_id");
  if (openId === undefined) {
    throw new ChannelCredentialProbeError("the Feishu API returned no bot open_id", false);
  }
  const username = readString(bot, "app_name");
  return {
    id: openId,
    ...(username === undefined ? {} : { username }),
    probedAt: new Date().toISOString(),
  };
}

/** Probe the app credential, then upsert the organization's Feishu Connection. */
export async function configureFeishuConnection(
  database: Database,
  input: { organizationId: string; accountId: string; credential: FeishuAppCredential },
): Promise<{ connectionId: string; identity: ChannelBotIdentity }> {
  const identity = await probeFeishuApp(input.credential);
  const { connectionId } = await database.configureChannelConnection({
    organizationId: input.organizationId,
    channel: "feishu",
    accountId: input.accountId,
    credentials: {
      appId: input.credential.appId.trim(),
      appSecret: input.credential.appSecret.trim(),
      ...(input.credential.verificationToken === undefined
        ? {}
        : { verificationToken: input.credential.verificationToken.trim() }),
      ...(input.credential.encryptKey === undefined
        ? {}
        : { encryptKey: input.credential.encryptKey.trim() }),
    },
    identity,
  });
  return { connectionId, identity };
}
