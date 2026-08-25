import { readFile } from "node:fs/promises";
import type { Provider, ProviderApplicationConfiguration } from "../index.js";

/** @package */
export async function readProviderApplicationEnvironment(
  environment: Record<string, string | undefined>,
): Promise<Partial<Record<Provider, ProviderApplicationConfiguration>>> {
  const github = await githubEnvironment(environment);
  const slack = slackEnvironment(environment);
  const discord = discordEnvironment(environment);
  return {
    ...(github === undefined ? {} : { github }),
    ...(slack === undefined ? {} : { slack }),
    ...(discord === undefined ? {} : { discord }),
  };
}

async function githubEnvironment(
  environment: Record<string, string | undefined>,
): Promise<ProviderApplicationConfiguration | undefined> {
  const appId = nonEmpty(environment["GITHUB_APP_ID"]);
  const appSlug = nonEmpty(environment["GITHUB_APP_SLUG"]);
  const clientId = nonEmpty(environment["GITHUB_APP_CLIENT_ID"]);
  const clientSecret = nonEmpty(environment["GITHUB_APP_CLIENT_SECRET"]);
  const webhookSecret = nonEmpty(environment["GITHUB_WEBHOOK_SECRET"]);
  const inlinePrivateKey = nonEmpty(environment["GITHUB_APP_PRIVATE_KEY"]);
  const privateKeyPath = nonEmpty(environment["GITHUB_APP_PRIVATE_KEY_PATH"]);
  if (
    appId === undefined ||
    appSlug === undefined ||
    clientId === undefined ||
    clientSecret === undefined ||
    webhookSecret === undefined ||
    (inlinePrivateKey === undefined && privateKeyPath === undefined)
  ) {
    return undefined;
  }
  const privateKey =
    inlinePrivateKey ??
    (privateKeyPath === undefined ? undefined : await readFile(privateKeyPath, "utf8"));
  if (privateKey === undefined || privateKey.length === 0) return undefined;
  return {
    provider: "github",
    appId,
    appSlug,
    clientId,
    clientSecret,
    privateKey,
    webhookSecret,
  };
}

function slackEnvironment(
  environment: Record<string, string | undefined>,
): ProviderApplicationConfiguration | undefined {
  const transport = nonEmpty(environment["SLACK_TRANSPORT"]);
  const appId = nonEmpty(environment["SLACK_APP_ID"]);
  const appToken = nonEmpty(environment["SLACK_APP_TOKEN"]);
  const clientId = nonEmpty(environment["SLACK_CLIENT_ID"]);
  const clientSecret = nonEmpty(environment["SLACK_CLIENT_SECRET"]);
  const signingSecret = nonEmpty(environment["SLACK_SIGNING_SECRET"]);
  const supplied = [transport, appId, appToken, clientId, clientSecret, signingSecret].some(
    (value) => value !== undefined,
  );
  if (!supplied) return undefined;

  const socketComplete =
    appId !== undefined &&
    appToken !== undefined &&
    clientId === undefined &&
    clientSecret === undefined &&
    signingSecret === undefined;
  if (transport === "socket" && socketComplete) {
    return { provider: "slack", transport, appId, appToken };
  }
  if (transport === "socket") {
    throw new Error(
      "Slack environment configuration for Socket Mode requires exactly SLACK_TRANSPORT=socket, SLACK_APP_ID, and SLACK_APP_TOKEN.",
    );
  }

  if (transport !== undefined && transport !== "webhook") {
    throw new Error("Slack environment configuration has an unknown SLACK_TRANSPORT value.");
  }
  if (
    appId !== undefined &&
    appToken === undefined &&
    clientId !== undefined &&
    clientSecret !== undefined &&
    signingSecret !== undefined
  ) {
    return {
      provider: "slack",
      transport: "webhook",
      appId,
      clientId,
      clientSecret,
      signingSecret,
    };
  }
  throw new Error(
    "Slack environment configuration for Webhooks requires SLACK_APP_ID, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_SIGNING_SECRET.",
  );
}

function discordEnvironment(
  environment: Record<string, string | undefined>,
): ProviderApplicationConfiguration | undefined {
  const applicationId = nonEmpty(environment["DISCORD_CLIENT_ID"]);
  const clientSecret = nonEmpty(environment["DISCORD_CLIENT_SECRET"]);
  const botToken = nonEmpty(environment["DISCORD_BOT_TOKEN"]);
  return applicationId === undefined || clientSecret === undefined || botToken === undefined
    ? undefined
    : { provider: "discord", applicationId, clientSecret, botToken };
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}
