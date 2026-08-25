import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { runWithFailureTracking } from "../failures/index.js";
import { createLogger } from "../logger.js";
import { FailureLogStream } from "../test-utils/failure-logs.js";
import { ProviderApplicationError, type Provider } from "./index.js";
import { providerApplicationSaveFailure } from "./save-failure.js";

function messageFor(provider: Provider, error: unknown, scrub: readonly string[] = []): string {
  return runWithFailureTracking(
    () => providerApplicationSaveFailure(provider, error, scrub),
    createLogger(new FailureLogStream()),
  ).error.message;
}

const REFERENCE = /If it happens again, quote reference [\w-]+ when reporting it\.$/u;

describe("provider application failure copy", () => {
  it("turns Discord gateway 4014 into an actionable, scrubbed, exactly-once failure", () => {
    const canary = "formatless-gateway-secret-2d81";
    const stream = new FailureLogStream();
    const gateway = Object.assign(new Error("safe gateway failure", { cause: new Error(canary) }), {
      name: "DiscordGatewayError",
      gatewayCloseCode: 4014,
      gatewayFailure: "disallowedIntents",
      code: "permissionMissing",
    });
    const error = new ProviderApplicationError(
      "permissionMissing",
      "discordGatewayDisallowedIntents",
      { cause: gateway },
    );

    const result = runWithFailureTracking(
      () => providerApplicationSaveFailure("discord", error, [canary]),
      createLogger(stream),
    );

    assert.equal(
      result.error.message,
      "Discord refused the bot because Message Content Intent is off, so it would only receive empty messages. Nothing was saved. Turn it on under Bot → Privileged Gateway Intents, save in Discord, then verify again.",
    );
    const records = stream.records();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.["operation"], "provider_application.verify_and_save");
    assert.equal(records[0]?.["component"], "provider_applications");
    assert.equal(records[0]?.["provider"], "discord");
    assert.equal(records[0]?.["failureKind"], "permissionMissing");
    assert.deepEqual(records[0]?.["diagnostic"], {
      gatewayCloseCode: 4014,
      gatewayFailure: "disallowedIntents",
    });
    assert.equal(stream.text().includes(canary), false);
  });

  it("names the exact credential Discord objected to", () => {
    assert.equal(
      messageFor("discord", new ProviderApplicationError("credentialsRejected", "botToken")),
      "Discord rejected the bot token. Nothing was saved. Open Bot → Reset Token, copy the new token, then verify again.",
    );
    assert.equal(
      messageFor("discord", new ProviderApplicationError("credentialsRejected", "clientSecret")),
      "Discord rejected the Client Secret. Nothing was saved. Open OAuth2, reset the Client Secret, copy it, then verify again.",
    );
  });

  it("does not collapse a wrong application into a rejected credential", () => {
    const discord = messageFor(
      "discord",
      new ProviderApplicationError("credentialsRejected", "identityMismatch"),
    );
    assert.match(discord, /belongs to a different Discord application/u);
    assert.doesNotMatch(discord, /Reset Token/u);

    const github = messageFor(
      "github",
      new ProviderApplicationError("credentialsRejected", "identityMismatch"),
    );
    assert.match(github, /belong to a different GitHub App/u);
    assert.doesNotMatch(github, /Generate a new private key/u);
  });

  it("names the exact Socket Mode token or permission to repair", () => {
    assert.match(
      messageFor("slack", new ProviderApplicationError("credentialsRejected", "appToken")),
      /app-level token.*App-Level Tokens.*connections:write/u,
    );
    assert.match(
      messageFor("slack", new ProviderApplicationError("credentialsRejected", "botToken")),
      /bot token.*Reinstall/u,
    );
    assert.match(
      messageFor("slack", new ProviderApplicationError("permissionMissing", "botToken")),
      /Socket Mode manifest.*reinstall/u,
    );
    assert.match(
      messageFor("slack", new ProviderApplicationError("credentialsRejected", "identityMismatch")),
      /belong to different Slack apps/u,
    );
  });

  it("says nothing was saved for every way a save can fail", () => {
    const failures: readonly [Provider, unknown][] = [
      ["github", new ProviderApplicationError("credentialsRejected", "privateKey")],
      ["github", new ProviderApplicationError("permissionMissing")],
      ["github", new ProviderApplicationError("rateLimited")],
      ["github", new ProviderApplicationError("timeout")],
      ["github", new ProviderApplicationError("network")],
      ["github", new ProviderApplicationError("upstreamUnavailable")],
      ["github", new ProviderApplicationError("configurationConflict")],
      ["github", new ProviderApplicationError("identityConflict", "Paseo Hub")],
      ["github", new ProviderApplicationError("invalidInput")],
      ["github", new ProviderApplicationError("internal")],
      ["github", new ProviderApplicationError("forbidden")],
      ["github", new ProviderApplicationError("managedByEnvironment")],
      ["slack", new ProviderApplicationError("httpsRequired", "http://127.0.0.1:6791")],
      ["discord", new Error("something nobody classified")],
    ];
    for (const [provider, error] of failures) {
      const message = messageFor(provider, error);
      assert.match(message, /Nothing was saved\./u, `no reassurance for ${String(error)}`);
      assert.ok(message.length > 40, `too terse to act on: ${message}`);
    }
  });

  it("offers a reference only for failures nobody can act on, and says what it is for", () => {
    const internal = messageFor("discord", new ProviderApplicationError("internal"));
    assert.match(
      internal,
      /^Something went wrong while saving Discord\. Nothing was saved\. Try again\. If it happens again, quote reference [\w-]+ when reporting it\.$/u,
    );
    assert.match(messageFor("github", new ProviderApplicationError("network")), REFERENCE);
    // An expected, actionable failure is not a support ticket.
    assert.doesNotMatch(
      messageFor("discord", new ProviderApplicationError("credentialsRejected", "botToken")),
      REFERENCE,
    );
    assert.doesNotMatch(
      messageFor("github", new ProviderApplicationError("configurationConflict")),
      REFERENCE,
    );
  });

  it("names the environment variables an environment-managed app is set from", () => {
    const message = messageFor("discord", new ProviderApplicationError("managedByEnvironment"));
    for (const name of ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN"]) {
      assert.ok(message.includes(name), `environment copy omits ${name}`);
    }
    assert.match(message, /restart Hub/u);
  });

  it("keeps Paseo's own vocabulary out of every failure the operator can read", () => {
    const forbidden = ["this hub", "app settings", "configuration version", "runtime", "latch"];
    const codes = [
      "credentialsRejected",
      "permissionMissing",
      "rateLimited",
      "network",
      "timeout",
      "upstreamUnavailable",
      "configurationConflict",
      "identityConflict",
      "invalidInput",
      "internal",
      "forbidden",
      "managedByEnvironment",
    ] as const;
    const messages: string[] = [];
    for (const code of codes) {
      for (const provider of ["github", "slack", "discord"] as const) {
        messages.push(messageFor(provider, new ProviderApplicationError(code)));
      }
    }
    for (const message of messages) {
      for (const term of forbidden) {
        assert.ok(!message.toLowerCase().includes(term), `"${term}" in: ${message}`);
      }
    }
  });
});
