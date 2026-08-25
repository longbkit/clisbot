import { z } from "zod";

export const SLACK_REQUIRED_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "chat:write",
  "files:read",
  "groups:history",
  "reactions:write",
  "users:read",
] as const;

const SlackOAuthResponseSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().optional(),
    app_id: z.string().optional(),
    access_token: z.string().optional(),
    bot_user_id: z.string().optional(),
    scope: z.string().optional(),
    team: z.object({ id: z.string().min(1), name: z.string().min(1) }).optional(),
  })
  .passthrough();

const SlackApiResponseSchema = z
  .object({ ok: z.boolean(), error: z.string().optional() })
  .passthrough();
const SlackAuthTestResponseSchema = SlackApiResponseSchema.extend({
  team_id: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
});

export interface SlackInstallation {
  appId: string;
  teamId: string;
  teamName: string;
  botUserId: string;
  botAccessToken: string;
  scopes: string[];
}

export function hasRequiredSlackScopes(scopes: readonly string[]): boolean {
  const granted = new Set(scopes);
  return SLACK_REQUIRED_BOT_SCOPES.every((scope) => granted.has(scope));
}

export interface SlackConnectionClient {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<SlackInstallation>;
  verifyInstallation(installation: SlackInstallation): Promise<void>;
  revoke(botAccessToken: string): Promise<void>;
}

export function createSlackConnectionClient(options: {
  appId: string;
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
  fetch?: typeof fetch;
}): SlackConnectionClient {
  const request = options.fetch ?? fetch;
  const redirectUri = new URL("/api/integrations/slack/callback", options.publicBaseUrl).toString();

  return {
    authorizationUrl(state) {
      const parameters = new URLSearchParams({
        client_id: options.clientId,
        scope: SLACK_REQUIRED_BOT_SCOPES.join(","),
        redirect_uri: redirectUri,
        state,
      });
      return `https://slack.com/oauth/v2/authorize?${parameters.toString()}`;
    },
    async exchangeCode(code) {
      const response = await request("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!response.ok) throw new Error(`Slack OAuth HTTP ${response.status}`);
      const result = SlackOAuthResponseSchema.parse(await response.json());
      if (!result.ok) throw new Error(`Slack OAuth ${result.error ?? "unknown_error"}`);
      if (
        result.app_id !== options.appId ||
        result.access_token === undefined ||
        result.bot_user_id === undefined ||
        result.team === undefined
      ) {
        throw new Error("Slack OAuth returned an invalid installation");
      }
      return {
        appId: result.app_id,
        teamId: result.team.id,
        teamName: result.team.name,
        botUserId: result.bot_user_id,
        botAccessToken: result.access_token,
        scopes: parseSlackScopes(result.scope),
      };
    },
    async verifyInstallation(installation) {
      if (!hasRequiredSlackScopes(installation.scopes)) throw new SlackBotVerificationError();
      const response = await request("https://slack.com/api/auth.test", {
        headers: { authorization: `Bearer ${installation.botAccessToken}` },
      });
      if (!response.ok) throw new SlackBotVerificationError();
      const result = SlackAuthTestResponseSchema.parse(await response.json());
      if (
        !result.ok ||
        result.team_id !== installation.teamId ||
        result.user_id !== installation.botUserId
      ) {
        throw new SlackBotVerificationError();
      }
    },
    async revoke(botAccessToken) {
      const response = await request("https://slack.com/api/auth.revoke", {
        method: "POST",
        headers: {
          authorization: `Bearer ${botAccessToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
      });
      if (!response.ok) throw new Error(`Slack revoke HTTP ${response.status}`);
      const result = SlackApiResponseSchema.parse(await response.json());
      if (!result.ok) throw new Error(`Slack revoke ${result.error ?? "unknown_error"}`);
    },
  };
}

export class SlackBotVerificationError extends Error {
  constructor() {
    super("Slack bot verification failed");
    this.name = "SlackBotVerificationError";
  }
}

function parseSlackScopes(scope: string | undefined): string[] {
  return [
    ...new Set(
      (scope ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].sort();
}
