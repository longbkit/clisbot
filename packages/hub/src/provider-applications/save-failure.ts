import { respondError } from "../contract/respond.js";
import { respondWithFailure } from "../failures/index.js";
import { guideFor } from "./guides.js";
import { ProviderApplicationError, type Provider } from "./index.js";

/**
 * Every way saving an app can fail, said the same way twice over: what happened, then the exact
 * next thing to do. Two rules hold across the whole table. Nothing is ever persisted by a failed
 * save, so every message may say so and none of them may leave the operator wondering. And a
 * message names the portal page and field to fix whenever the provider told us which one it was.
 */
export function providerApplicationSaveFailure(
  provider: Provider,
  error: unknown,
  scrubValues: readonly string[] = [],
  operation = "provider_application.verify_and_save",
): ReturnType<typeof respondError> {
  const name = providerName(provider);
  const code = errorCode(error);
  const gateway = discordGatewayDiagnostic(error);
  const report = { operation, component: "provider_applications", provider } as const;

  if ((provider === "slack" || provider === "linear") && code === "httpsRequired") {
    return respondWithFailure(
      error,
      report,
      {
        fallback: `${name} only works over HTTPS, and Hub is at ${errorContext(error) ?? "an HTTP address"}. Nothing was saved. Reopen Hub at its public HTTPS address to set up ${name}.`,
      },
      { kind: "validation", scrubValues },
    );
  }
  if (code === "managedByEnvironment") {
    return respondWithFailure(
      error,
      report,
      {
        fallback: `${name} is set by Hub's environment, so it cannot be edited here. Nothing was saved. Change ${environmentVariables(provider)} where you set Hub's environment, then restart Hub.`,
      },
      { kind: "conflict", scrubValues },
    );
  }
  if (code === "configurationConflict") {
    return respondWithFailure(
      error,
      report,
      {
        fallback: `Someone else changed the ${name} app while this page was open. Nothing was saved. Reload the page to see the current values, then verify again.`,
      },
      { kind: "conflict", scrubValues },
    );
  }
  if (code === "identityConflict") {
    const identity = errorContext(error) ?? name;
    return respondWithFailure(
      error,
      report,
      {
        fallback: `${name} is already connected as ${identity}, and connections cannot move to a different ${applicationNoun(provider)}. Nothing was saved. Remove its connections first, or rotate the secrets of the same ${applicationNoun(provider)}.`,
      },
      { kind: "conflict", scrubValues },
    );
  }
  if (code === "credentialsRejected") {
    return respondWithFailure(
      error,
      report,
      { fallback: credentialMessage(provider, errorContext(error)) },
      { kind: "credentialsRejected", scrubValues },
    );
  }
  if (provider === "slack" && code === "permissionMissing") {
    return respondWithFailure(
      error,
      report,
      { fallback: slackPermissionMessage(errorContext(error)) },
      { kind: "permissionMissing", scrubValues },
    );
  }
  if (provider === "discord" && errorContext(error) === "discordGatewayDisallowedIntents") {
    return respondWithFailure(
      error,
      report,
      {
        fallback:
          "Discord refused the bot because Message Content Intent is off, so it would only receive empty messages. Nothing was saved. Turn it on under Bot → Privileged Gateway Intents, save in Discord, then verify again.",
      },
      {
        kind: "permissionMissing",
        scrubValues,
        ...(gateway === undefined ? {} : { diagnostic: gateway }),
      },
    );
  }

  return respondWithFailure(
    error,
    report,
    {
      fallback: `Something went wrong while saving ${name}. Nothing was saved. Try again.`,
      forbidden: `Only an instance operator can change the ${name} app. Nothing was saved.`,
      authentication: `Your session has expired. Nothing was saved. Sign in again, then verify again.`,
      credentialsRejected: credentialMessage(provider, errorContext(error)),
      permissionMissing: `${name} accepted the credentials but the ${applicationNoun(provider)} is missing a permission Hub needs. Nothing was saved. Grant every permission listed in the setup steps, then verify again.`,
      network: `Hub couldn't reach ${name}. Nothing was saved. Check this server's network, DNS, and TLS access to ${providerHost(provider)}, then verify again.`,
      timeout: `${name} didn't answer in time. Nothing was saved. Check this server's connection to ${providerHost(provider)}, then verify again.`,
      rateLimited: `${name} is rate limiting Hub. Nothing was saved. Wait a few minutes, then verify again.`,
      upstreamUnavailable: `${name} returned an error of its own. Nothing was saved. Check ${name}'s status page, then verify again.`,
      conflict: `The ${name} app changed while it was being saved. Nothing was saved. Reload the page to see the current values, then verify again.`,
      validation: `Some of the ${name} details were missing or malformed. Nothing was saved. Check every field against the setup steps, then verify again.`,
    },
    { scrubValues, ...(gateway === undefined ? {} : { diagnostic: gateway }) },
  );
}

export function providerHost(provider: Provider): string {
  if (provider === "github") return "api.github.com";
  if (provider === "slack") return "slack.com";
  if (provider === "linear") return "linear.app";
  return "discord.com";
}

export function providerName(provider: Provider): string {
  if (provider === "github") return "GitHub";
  if (provider === "slack") return "Slack";
  if (provider === "linear") return "Linear";
  return "Discord";
}

/** GitHub calls it an App, Discord an application, Slack an app. Use each provider's own word. */
function applicationNoun(provider: Provider): string {
  if (provider === "github") return "App";
  return "application";
}

function environmentVariables(provider: Provider): string {
  const names = guideFor(provider).environmentVariables;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A rejected secret and a secret that belongs to somebody else's app are different problems with
 * different fixes, and the operator only re-copies a value when re-copying is the fix.
 */
function credentialMessage(provider: Provider, subject: string | undefined): string {
  if (subject === "identityMismatch") return identityMismatchMessage(provider);
  if (provider === "github") {
    if (subject === "privateKey") {
      return "GitHub rejected the Private key for this App. Nothing was saved. Generate a new private key on the App's settings page, paste the whole .pem file, then verify again.";
    }
    return "GitHub rejected these credentials. Nothing was saved. Check the App ID and Private key on the App's settings page, then verify again.";
  }
  if (provider === "discord") {
    if (subject === "botToken") {
      return "Discord rejected the bot token. Nothing was saved. Open Bot → Reset Token, copy the new token, then verify again.";
    }
    if (subject === "clientSecret") {
      return "Discord rejected the Client Secret. Nothing was saved. Open OAuth2, reset the Client Secret, copy it, then verify again.";
    }
    return "Discord rejected these credentials. Nothing was saved. Check the Application ID, Client Secret, and bot token, then verify again.";
  }
  if (provider === "linear") {
    return "Linear rejected these app credentials. Nothing was saved. Check the Client ID and Client Secret in the Linear application, then continue again.";
  }
  if (subject === "appToken") {
    return "Slack rejected the app-level token. Nothing was saved. Open Basic Information → App-Level Tokens, generate one with connections:write, then connect again.";
  }
  if (subject === "botToken") {
    return "Slack rejected the bot token. Nothing was saved. Reinstall the app in that workspace, copy its new bot token, then connect again.";
  }
  return "Slack rejected these app credentials. Nothing was saved. Check every value under Basic Information → App Credentials, then continue again.";
}

function slackPermissionMessage(subject: string | undefined): string {
  if (subject === "appToken") {
    return "The app-level token is missing connections:write. Nothing was saved. Generate a new app-level token with that scope, then connect again.";
  }
  return "The bot token is missing permissions Hub needs. Nothing was saved. Reapply the Socket Mode manifest, reinstall the app in the workspace, then connect again.";
}

function identityMismatchMessage(provider: Provider): string {
  if (provider === "github") {
    return "These credentials belong to a different GitHub App than the App ID you entered. Nothing was saved. Copy the App ID from the same App's settings page, then verify again.";
  }
  if (provider === "discord") {
    return "That bot token belongs to a different Discord application than the Application ID you entered. Nothing was saved. Copy both values from the same application, then verify again.";
  }
  if (provider === "linear") {
    return "The Linear Client ID and Client Secret do not belong to the same application. Nothing was saved. Copy both from one Linear application, then continue again.";
  }
  return "The app-level token and bot token belong to different Slack apps. Nothing was saved. Copy both tokens from the same app, then connect again.";
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof ProviderApplicationError) return error.code;
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

function errorContext(error: unknown): string | undefined {
  if (error instanceof ProviderApplicationError) return error.safeContext;
  if (typeof error !== "object" || error === null) return undefined;
  const context: unknown = Reflect.get(error, "safeContext");
  return typeof context === "string" ? context : undefined;
}

function discordGatewayDiagnostic(
  error: unknown,
): { gatewayCloseCode: number; gatewayFailure: string } | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.name === "DiscordGatewayError") {
      const gatewayCloseCode: unknown = Reflect.get(current, "gatewayCloseCode");
      const gatewayFailure: unknown = Reflect.get(current, "gatewayFailure");
      return typeof gatewayCloseCode === "number" && typeof gatewayFailure === "string"
        ? { gatewayCloseCode, gatewayFailure }
        : undefined;
    }
    current = current.cause;
  }
  return undefined;
}
