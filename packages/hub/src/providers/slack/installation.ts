import { z } from "zod";
import { ProviderVerificationError } from "../../provider-applications/index.js";
import {
  openSlackSocket,
  SlackSocketConnectionError,
} from "../../triggers/slack/source/internal/connection.js";
import { SLACK_REQUIRED_BOT_SCOPES } from "./client.js";

const AuthTestSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  team_id: z.string().min(1).optional(),
  team: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  bot_id: z.string().min(1).optional(),
});
const BotInfoSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  bot: z
    .object({ id: z.string().min(1), app_id: z.string().min(1), user_id: z.string().min(1) })
    .optional(),
});

export interface VerifiedSlackSocketInstallation {
  appId: string;
  teamId: string;
  teamName: string;
  botUserId: string;
  botAccessToken: string;
  scopes: string[];
}

export interface SlackSocketInstallationVerifier {
  verify(appToken: string, botToken: string): Promise<VerifiedSlackSocketInstallation>;
}

export function createSlackSocketInstallationVerifier(
  options: { apiBaseUrl?: string; timeoutMs?: number } = {},
): SlackSocketInstallationVerifier {
  const api = options.apiBaseUrl ?? "https://slack.com/api";
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    async verify(appToken, botToken) {
      const transaction = new AbortController();
      const timeout = setTimeout(
        () => transaction.abort(new Error("Slack verification timed out")),
        timeoutMs,
      );
      try {
        const connection = await openSlackSocket({
          appToken,
          apiUrl: `${api}/apps.connections.open`,
          signal: transaction.signal,
          timeoutMs,
        }).catch((error: unknown) => {
          if (transaction.signal.aborted) throw new ProviderVerificationError("timeout");
          return mapConnectionError(error);
        });
        await connection.close(Math.max(10, Math.min(500, timeoutMs / 4)), "verified");

        const auth = await slackJson(
          fetch,
          `${api}/auth.test`,
          botToken,
          AuthTestSchema,
          transaction,
        );
        const scopes = parseScopes(auth.response.headers.get("x-oauth-scopes"));
        if (!auth.value.ok) throw verificationError(auth.value.error, auth.response.status);
        if (
          auth.value.team_id === undefined ||
          auth.value.team === undefined ||
          auth.value.user_id === undefined ||
          auth.value.bot_id === undefined
        ) {
          throw new ProviderVerificationError("invalidResponse", auth.response.status);
        }
        if (SLACK_REQUIRED_BOT_SCOPES.some((scope) => !scopes.includes(scope))) {
          throw new ProviderVerificationError("permissionMissing", auth.response.status, {
            subject: "botToken",
          });
        }
        const info = await slackJson(
          fetch,
          `${api}/bots.info?${new URLSearchParams({ bot: auth.value.bot_id })}`,
          botToken,
          BotInfoSchema,
          transaction,
        );
        if (!info.value.ok || info.value.bot === undefined) {
          throw verificationError(info.value.error, info.response.status);
        }
        if (
          info.value.bot.app_id !== connection.appId ||
          info.value.bot.user_id !== auth.value.user_id ||
          info.value.bot.id !== auth.value.bot_id
        ) {
          throw new ProviderVerificationError("credentialsRejected", undefined, {
            subject: "identityMismatch",
          });
        }
        return {
          appId: connection.appId,
          teamId: auth.value.team_id,
          teamName: auth.value.team,
          botUserId: auth.value.user_id,
          botAccessToken: botToken,
          scopes,
        };
      } catch (error) {
        if (error instanceof ProviderVerificationError) throw error;
        if (transaction.signal.aborted) throw new ProviderVerificationError("timeout");
        throw new ProviderVerificationError("network", undefined, { cause: error });
      } finally {
        clearTimeout(timeout);
        transaction.abort();
      }
    },
  };
}

async function slackJson<T>(
  request: typeof fetch,
  url: string,
  token: string,
  schema: z.ZodType<T>,
  transaction: AbortController,
): Promise<{ value: T; response: Response }> {
  let response: Response;
  try {
    response = await request(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: transaction.signal,
    });
  } catch (error) {
    if (transaction.signal.aborted) throw new ProviderVerificationError("timeout");
    throw new ProviderVerificationError("network", undefined, { cause: error });
  }
  if (!response.ok) {
    transaction.abort(new Error("Slack verification response discarded"));
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429) throw new ProviderVerificationError("rateLimited", 429);
    if (response.status >= 500)
      throw new ProviderVerificationError("upstreamUnavailable", response.status);
    throw new ProviderVerificationError("credentialsRejected", response.status);
  }
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new ProviderVerificationError("invalidResponse", response.status);
  return { value: parsed.data, response };
}

function mapConnectionError(error: unknown): never {
  if (!(error instanceof SlackSocketConnectionError)) throw error;
  if (error.code === "rate_limited") throw new ProviderVerificationError("rateLimited", 429);
  if (error.code.startsWith("http_5")) {
    throw new ProviderVerificationError("upstreamUnavailable", Number(error.code.slice(5)));
  }
  if (error.reason === "transient") throw new ProviderVerificationError("network");
  throw new ProviderVerificationError("credentialsRejected", undefined, { subject: "appToken" });
}

function verificationError(error: string | undefined, status?: number): ProviderVerificationError {
  return new ProviderVerificationError(
    error === "missing_scope" ? "permissionMissing" : "credentialsRejected",
    status,
    { subject: "botToken" },
  );
}

function parseScopes(value: string | null): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ].sort();
}
