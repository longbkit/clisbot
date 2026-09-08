// The Hub-side Discord token probe, pinned against the vertical's own
// `probe.ts`. The Hub restates the probe because its production code never
// imports a channel vertical (the verticals are supply the loader resolves at
// runtime, and they are devDependencies here); the differential cases below are
// what keep the restatement honest — both implementations see the same fake
// Discord REST and must agree on identity, application id and rejection.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import {
  parseApplicationIdFromToken,
  probeDiscord,
} from "@getpaseo/channels-discord/dist/probe.js";
import { createMemoryDatabase } from "../../db/memory.js";
import {
  configureDiscordConnection,
  parseDiscordApplicationId,
  probeDiscordBotToken,
} from "./discord.js";
import { ChannelCredentialProbeError } from "./probe.js";

const APPLICATION_ID = "1180000000000000009";
const TOKEN = `${Buffer.from(APPLICATION_ID, "utf8").toString("base64url")}.Gxxxxx.canary-secret`;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Discord's `GET /users/@me`: the bot identity for a good token, 401 otherwise. */
function stubDiscord(): { requests: Array<{ url: string; authorization: string | null }> } {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(input), authorization: headers.get("authorization") });
    if (headers.get("authorization") !== `Bot ${TOKEN}`) {
      return new Response(JSON.stringify({ message: "401: Unauthorized" }), { status: 401 });
    }
    return Response.json({ id: "900000000000000001", username: "fusion-bot", bot: true });
  }) as typeof fetch;
  return { requests };
}

describe("Discord bot-token probe", () => {
  it("reads the bot identity from GET /users/@me and the application id from the token", async () => {
    const { requests } = stubDiscord();
    const identity = await probeDiscordBotToken(TOKEN);
    assert.deepEqual(requests, [
      { url: "https://discord.com/api/v10/users/@me", authorization: `Bot ${TOKEN}` },
    ]);
    assert.equal(identity.id, "900000000000000001");
    assert.equal(identity.username, "fusion-bot");
    assert.equal(identity.applicationId, APPLICATION_ID);
    assert.ok(Date.parse(identity.probedAt) > 0);
  });

  it("accepts a pasted `Bot <token>` and stores the normalized token", async () => {
    stubDiscord();
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const { connectionId, identity } = await configureDiscordConnection(database, {
      organizationId: "org",
      accountId: "guild",
      botToken: `Bot ${TOKEN}`,
    });
    assert.equal(identity.id, "900000000000000001");
    assert.deepEqual(
      await database.resolveChannelConnection({
        organizationId: "org",
        channel: "discord",
        connectionId,
      }),
      { botToken: TOKEN },
    );
  });

  it("reports a rejected token without echoing it, and stores nothing", async () => {
    stubDiscord();
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const error = await configureDiscordConnection(database, {
      organizationId: "org",
      accountId: "guild",
      botToken: "wrong-token",
    }).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof ChannelCredentialProbeError);
    assert.equal(error.rejected, true);
    assert.equal(error.message.includes("wrong-token"), false);
  });

  it("agrees with the vertical's probe on identity, application id and rejection", async () => {
    stubDiscord();
    const mine = await probeDiscordBotToken(TOKEN);
    const theirs = await probeDiscord(TOKEN, 5_000);
    assert.equal(theirs.ok, true);
    assert.equal(mine.id, theirs.bot?.id);
    assert.equal(mine.username, theirs.bot?.username);
    assert.equal(parseDiscordApplicationId(TOKEN), parseApplicationIdFromToken(TOKEN));
    assert.equal(
      parseDiscordApplicationId("wrong-token"),
      parseApplicationIdFromToken("wrong-token"),
    );

    const rejected = await probeDiscord("wrong-token", 5_000);
    assert.equal(rejected.ok, false);
    await assert.rejects(() => probeDiscordBotToken("wrong-token"), ChannelCredentialProbeError);
  });
});
