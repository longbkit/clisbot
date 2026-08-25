import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "vitest";
import { ProviderVerificationError, createProviderApplicationVerifier } from "./index.js";

const DISCORD_IDENTITY = { id: "100", username: "Paseo", bot: true };
const DISCORD_CONFIGURATION = {
  provider: "discord" as const,
  applicationId: "100",
  clientSecret: "secret",
  botToken: "token",
};

/**
 * Answers the way Discord does: the bot identity from `users/@me`, an access token from the
 * client credentials grant, and an accepted revocation. Each call is recorded so a test can
 * assert what was actually asked of the provider.
 */
function discordProvider(
  overrides: {
    identity?: () => Response;
    token?: (authorization: string, body: string) => Response;
  } = {},
) {
  const calls: { url: string; authorization: string; body: string }[] = [];
  const fetchLike: typeof fetch = (input, init) => {
    const url = requestUrl(input);
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, authorization, body });
    if (url.endsWith("/users/@me")) {
      return Promise.resolve(overrides.identity?.() ?? Response.json(DISCORD_IDENTITY));
    }
    if (url.endsWith("/oauth2/token")) {
      return Promise.resolve(
        overrides.token?.(authorization, body) ??
          Response.json({ access_token: "minted", token_type: "Bearer", expires_in: 604800 }),
      );
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  return { calls, fetch: fetchLike };
}

describe("provider application verification", () => {
  it("authenticates a GitHub App against the fixed API endpoint and returns its identity", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const requests: string[] = [];
    const verifier = createProviderApplicationVerifier({
      now: () => Date.parse("2026-08-14T12:00:00Z"),
      fetch: (input, init) => {
        requests.push(requestUrl(input));
        assert.match(new Headers(init?.headers).get("authorization") ?? "", /^Bearer /u);
        return Promise.resolve(
          Response.json({ id: 42, name: "Paseo Hub", owner: { login: "acme" } }),
        );
      },
    });

    assert.deepEqual(
      await verifier.verify("github", {
        provider: "github",
        appId: "42",
        appSlug: "paseo",
        clientId: "client",
        clientSecret: "secret",
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        webhookSecret: "webhook",
      }),
      { provider: "github", id: "42", name: "Paseo Hub", ownerLogin: "acme" },
    );
    assert.deepEqual(requests, ["https://api.github.com/app"]);
  });

  it("says an App ID that names a different App is a mismatch, not a bad key", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const verifier = createProviderApplicationVerifier({
      fetch: () =>
        Promise.resolve(Response.json({ id: 99, name: "Other App", owner: { login: "acme" } })),
    });

    await assert.rejects(
      verifier.verify("github", {
        provider: "github",
        appId: "42",
        appSlug: "paseo",
        clientId: "client",
        clientSecret: "secret",
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      }),
      (error: unknown) =>
        error instanceof ProviderVerificationError && error.subject === "identityMismatch",
    );
  });

  it("proves the Discord bot identity and the Client Secret before claiming Verified", async () => {
    const provider = discordProvider();
    const verifier = createProviderApplicationVerifier({ fetch: provider.fetch });

    assert.deepEqual(await verifier.verify("discord", DISCORD_CONFIGURATION), {
      provider: "discord",
      id: "100",
      name: "Paseo",
    });

    const token = provider.calls.find((call) => call.url.endsWith("/oauth2/token"));
    assert.ok(token, "the Client Secret was never checked against Discord");
    // The documented client credentials grant: Basic auth of client id and secret, form encoded.
    assert.equal(token.authorization, `Basic ${Buffer.from("100:secret").toString("base64")}`);
    assert.match(token.body, /grant_type=client_credentials/u);
    assert.match(token.body, /scope=identify/u);
    // Verification must not leave a live bearer token behind that nobody asked for.
    assert.ok(
      provider.calls.some((call) => call.url.endsWith("/oauth2/token/revoke")),
      "the minted access token was never revoked",
    );
  });

  it("keeps a rejected bot token, a rejected Client Secret, and a wrong application apart", async () => {
    const rejectedToken = createProviderApplicationVerifier({
      fetch: discordProvider({ identity: () => new Response(null, { status: 401 }) }).fetch,
    });
    await assert.rejects(
      rejectedToken.verify("discord", DISCORD_CONFIGURATION),
      (error: unknown) =>
        error instanceof ProviderVerificationError &&
        error.reason === "credentialsRejected" &&
        error.subject === "botToken",
    );

    const wrongApplication = createProviderApplicationVerifier({ fetch: discordProvider().fetch });
    await assert.rejects(
      wrongApplication.verify("discord", { ...DISCORD_CONFIGURATION, applicationId: "200" }),
      (error: unknown) =>
        error instanceof ProviderVerificationError && error.subject === "identityMismatch",
    );

    const rejectedSecret = createProviderApplicationVerifier({
      fetch: discordProvider({
        token: () => Response.json({ error: "invalid_client" }, { status: 401 }),
      }).fetch,
    });
    await assert.rejects(
      rejectedSecret.verify("discord", DISCORD_CONFIGURATION),
      (error: unknown) =>
        error instanceof ProviderVerificationError &&
        error.reason === "credentialsRejected" &&
        error.subject === "clientSecret",
    );
  });

  it("still verifies when Discord refuses to revoke the token it just minted", async () => {
    const provider = discordProvider();
    const verifier = createProviderApplicationVerifier({
      fetch: (input, init) =>
        requestUrl(input).endsWith("/oauth2/token/revoke")
          ? Promise.reject(new Error("revocation unavailable"))
          : provider.fetch(input, init),
    });

    assert.equal((await verifier.verify("discord", DISCORD_CONFIGURATION)).id, "100");
  });

  it("projects transport failures without returning upstream details", async () => {
    const verifier = createProviderApplicationVerifier({
      fetch: () => Promise.reject(new Error("token=super-secret")),
    });
    await assert.rejects(
      verifier.verify("discord", { ...DISCORD_CONFIGURATION, botToken: "super-secret" }),
      (error: unknown) =>
        error instanceof ProviderVerificationError &&
        error.reason === "network" &&
        !error.message.includes("super-secret") &&
        !(error.cause instanceof Error && error.cause.message.includes("super-secret")),
    );
  });

  for (const [status, reason] of [
    [429, "rateLimited"],
    [503, "upstreamUnavailable"],
  ] as const) {
    it(`classifies Discord HTTP ${status} without reading its sensitive payload`, async () => {
      let bodyRead = false;
      const response = new Response(null, { status });
      Object.defineProperty(response, "json", {
        value: () => {
          bodyRead = true;
          return Promise.resolve({ payload: "PRIVATE-UPSTREAM-PAYLOAD" });
        },
      });
      const verifier = createProviderApplicationVerifier({
        fetch: () => Promise.resolve(response),
      });
      await assert.rejects(
        verifier.verify("discord", {
          provider: "discord",
          applicationId: "100",
          clientSecret: "PRIVATE-CLIENT-SECRET",
          botToken: "PRIVATE-BOT-TOKEN",
        }),
        (error: unknown) =>
          error instanceof ProviderVerificationError &&
          error.reason === reason &&
          error.safeStatus === status,
      );
      assert.equal(bodyRead, false);
    });
  }

  it("classifies a successful response with invalid JSON separately", async () => {
    const verifier = createProviderApplicationVerifier({
      fetch: () => Promise.resolve(new Response("not-json", { status: 200 })),
    });
    await assert.rejects(
      verifier.verify("discord", DISCORD_CONFIGURATION),
      (error: unknown) =>
        error instanceof ProviderVerificationError && error.reason === "invalidResponse",
    );
  });
});

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
