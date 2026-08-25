import jwt from "jsonwebtoken";
import { z } from "zod";
import type {
  ProviderApplicationConfiguration,
  ProviderApplicationIdentity,
  ProviderApplicationVerifier,
} from "../index.js";
import { ProviderVerificationError } from "../index.js";

const githubIdentitySchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});
const discordIdentitySchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  bot: z.literal(true),
});
const discordTokenSchema = z.object({ access_token: z.string().min(1) });
const DEFAULT_TIMEOUT_MS = 8_000;
const DISCORD_API = "https://discord.com/api/v10";

/** @package */
export function createProviderApplicationVerifier(
  options: {
    fetch?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
  } = {},
): ProviderApplicationVerifier {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    verify(provider, configuration) {
      if (provider !== configuration.provider) {
        return Promise.reject(new ProviderVerificationError("credentialsRejected"));
      }
      if (configuration.provider === "github") {
        return verifyGitHub(configuration, request, now, timeoutMs);
      }
      if (configuration.provider === "discord") {
        return verifyDiscord(configuration, request, timeoutMs);
      }
      // Slack client credentials have no honest verification endpoint. They are verified only
      // by the OAuth installation callback, where the returned bot token is tested.
      return Promise.reject(new ProviderVerificationError("credentialsRejected"));
    },
  };
}

async function verifyGitHub(
  configuration: Extract<ProviderApplicationConfiguration, { provider: "github" }>,
  request: typeof fetch,
  now: () => number,
  timeoutMs: number,
): Promise<ProviderApplicationIdentity> {
  let token: string;
  try {
    const nowSeconds = Math.floor(now() / 1000);
    token = jwt.sign(
      { iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: configuration.appId },
      configuration.privateKey,
      { algorithm: "RS256" },
    );
  } catch {
    throw new ProviderVerificationError("credentialsRejected", undefined, {
      subject: "privateKey",
    });
  }
  const response = await fixedRequest(
    request,
    "https://api.github.com/app",
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
    timeoutMs,
  );
  if (response.status === 401 || response.status === 403) {
    throw new ProviderVerificationError("credentialsRejected", response.status, {
      subject: "privateKey",
    });
  }
  rejectFailedResponse(response);
  const body = await safeJson(response);
  if (body === undefined) throw new ProviderVerificationError("invalidResponse", response.status);
  const parsed = githubIdentitySchema.safeParse(body);
  if (!parsed.success) throw new ProviderVerificationError("invalidResponse", response.status);
  // The key authenticated an App, just not the one the operator named. That is a different
  // problem from a key GitHub refused, and it gets a different answer.
  if (String(parsed.data.id) !== configuration.appId) {
    throw new ProviderVerificationError("credentialsRejected", undefined, {
      subject: "identityMismatch",
    });
  }
  return {
    provider: "github",
    id: String(parsed.data.id),
    name: parsed.data.name,
    ownerLogin: parsed.data.owner.login,
  };
}

/**
 * Two proofs, because Discord splits its credentials across two portal pages. The bot token
 * proves the bot and names the application; the client credentials grant proves the Client
 * Secret the connection flow will later need. Verifying only the first would let the surface
 * claim "Verified" for an application that cannot complete a single authorization.
 */
async function verifyDiscord(
  configuration: Extract<ProviderApplicationConfiguration, { provider: "discord" }>,
  request: typeof fetch,
  timeoutMs: number,
): Promise<ProviderApplicationIdentity> {
  const identity = await verifyDiscordBot(configuration, request, timeoutMs);
  await verifyDiscordClientSecret(configuration, request, timeoutMs);
  return identity;
}

async function verifyDiscordBot(
  configuration: Extract<ProviderApplicationConfiguration, { provider: "discord" }>,
  request: typeof fetch,
  timeoutMs: number,
): Promise<ProviderApplicationIdentity> {
  const response = await fixedRequest(
    request,
    `${DISCORD_API}/users/@me`,
    { headers: { authorization: `Bot ${configuration.botToken}` } },
    timeoutMs,
  );
  if (response.status === 401 || response.status === 403) {
    throw new ProviderVerificationError("credentialsRejected", response.status, {
      subject: "botToken",
    });
  }
  rejectFailedResponse(response);
  const body = await safeJson(response);
  if (body === undefined) throw new ProviderVerificationError("invalidResponse", response.status);
  const parsed = discordIdentitySchema.safeParse(body);
  if (!parsed.success) throw new ProviderVerificationError("invalidResponse", response.status);
  if (parsed.data.id !== configuration.applicationId) {
    throw new ProviderVerificationError("credentialsRejected", undefined, {
      subject: "identityMismatch",
    });
  }
  return { provider: "discord", id: parsed.data.id, name: parsed.data.username };
}

/**
 * Discord's documented client credentials grant, the one exchange that can answer "is this
 * Client Secret real?" without a user present. It mints a bearer token for the app owner, so
 * the token is revoked immediately — a check should not leave credentials lying around. Team
 * applications are limited to `identify`, which is why that is the scope asked for.
 */
async function verifyDiscordClientSecret(
  configuration: Extract<ProviderApplicationConfiguration, { provider: "discord" }>,
  request: typeof fetch,
  timeoutMs: number,
): Promise<void> {
  const authorization = `Basic ${Buffer.from(
    `${configuration.applicationId}:${configuration.clientSecret}`,
  ).toString("base64")}`;
  const response = await fixedRequest(
    request,
    `${DISCORD_API}/oauth2/token`,
    {
      method: "POST",
      headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "identify",
      }).toString(),
    },
    timeoutMs,
  );
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new ProviderVerificationError("credentialsRejected", response.status, {
      subject: "clientSecret",
    });
  }
  rejectFailedResponse(response);
  const body = await safeJson(response);
  if (body === undefined) throw new ProviderVerificationError("invalidResponse", response.status);
  const parsed = discordTokenSchema.safeParse(body);
  if (!parsed.success) throw new ProviderVerificationError("invalidResponse", response.status);
  await revokeDiscordToken(request, authorization, parsed.data.access_token, timeoutMs);
}

/** Best effort. The secret is already proven; a token Discord will expire anyway is not a failure. */
async function revokeDiscordToken(
  request: typeof fetch,
  authorization: string,
  token: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await request(`${DISCORD_API}/oauth2/token/revoke`, {
      method: "POST",
      headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, token_type_hint: "access_token" }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return;
  }
}

async function fixedRequest(
  request: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await request(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timeout =
      error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new ProviderVerificationError(timeout ? "timeout" : "network", undefined, {
      cause: safeTransportCause(error),
    });
  }
}

function safeTransportCause(error: unknown): Error {
  if (!(error instanceof Error)) return new Error("provider transport failed");
  const diagnostic = new Error("provider transport failed");
  diagnostic.name = error.name;
  const frames = error.stack?.split("\n").slice(1).join("\n");
  if (frames !== undefined && frames.length > 0) {
    diagnostic.stack = `${diagnostic.name}: ${diagnostic.message}\n${frames}`;
  }
  const code: unknown = Reflect.get(error, "code");
  if (typeof code === "string" && /^[A-Z0-9_]+$/u.test(code)) {
    Object.assign(diagnostic, { code });
  }
  return diagnostic;
}

function rejectFailedResponse(response: Response): void {
  if (response.ok) return;
  if (response.status === 429) throw new ProviderVerificationError("rateLimited", response.status);
  throw new ProviderVerificationError("upstreamUnavailable", response.status);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
