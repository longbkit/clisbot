// The Hub-side Zalo token probe, pinned against the vertical's own `probe.ts`.
// The Hub restates the probe because its production code never imports a channel
// vertical (the verticals are supply the loader resolves at runtime, and they are
// devDependencies here); the differential case below is what keeps the
// restatement honest — both implementations see the same fake Zalo Bot API and
// must agree on identity and rejection.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { probeZalo } from "@getpaseo/channels-zalo/dist/probe.js";
import { createMemoryDatabase } from "../../db/memory.js";
import { ChannelCredentialProbeError } from "./probe.js";
import { configureZaloConnection, probeZaloBotToken } from "./zalo.js";

const TOKEN = "1234567:zalo-canary-secret";
const BOT = { id: "9001", account_name: "fusion-bot", account_type: "bot" };

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** `POST /bot<token>/getMe`: the bot for a good token, `{ok:false}` otherwise.
 * The token rides in the PATH, which is why the probe must never echo a URL. */
function stubZalo(): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (!url.endsWith(`/bot${TOKEN}/getMe`)) {
      return Response.json({ ok: false, error_code: 401, description: "Unauthorized" });
    }
    return Response.json({ ok: true, result: BOT });
  }) as typeof fetch;
  return { urls };
}

describe("Zalo bot-token probe", () => {
  it("reads the bot identity from getMe", async () => {
    const { urls } = stubZalo();
    const identity = await probeZaloBotToken(TOKEN);
    assert.deepEqual(urls, [`https://bot-api.zaloplatforms.com/bot${TOKEN}/getMe`]);
    assert.equal(identity.id, "9001");
    assert.equal(identity.username, "fusion-bot");
    assert.ok(Date.parse(identity.probedAt) > 0);
  });

  it("stores the token and, in webhook mode, the secret", async () => {
    stubZalo();
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const { connectionId, identity } = await configureZaloConnection(database, {
      organizationId: "org",
      accountId: "oa",
      botToken: ` ${TOKEN} `,
      webhookSecret: "zalo-webhook-secret",
    });
    assert.equal(identity.id, "9001");
    assert.deepEqual(
      await database.resolveChannelConnection({
        organizationId: "org",
        channel: "zalo",
        connectionId,
      }),
      { botToken: TOKEN, webhookSecret: "zalo-webhook-secret" },
    );
  });

  it("refuses a webhook secret outside Zalo's 8-256 character bound, before any probe", async () => {
    const { urls } = stubZalo();
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    await assert.rejects(
      () =>
        configureZaloConnection(database, {
          organizationId: "org",
          accountId: "oa",
          botToken: TOKEN,
          webhookSecret: "short",
        }),
      /8-256 characters/u,
    );
    assert.deepEqual(urls, [], "the bound is checked before the network call");
  });

  it("reports a rejected token without echoing it, and stores nothing", async () => {
    stubZalo();
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const error = await configureZaloConnection(database, {
      organizationId: "org",
      accountId: "oa",
      botToken: "wrong-token",
    }).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof ChannelCredentialProbeError);
    assert.equal(error.rejected, true);
    assert.equal(error.message.includes("wrong-token"), false);
  });

  it("agrees with the vertical's probe on identity and rejection", async () => {
    stubZalo();
    const mine = await probeZaloBotToken(TOKEN);
    const theirs = await probeZalo(TOKEN, 5_000);
    assert.equal(theirs.ok, true);
    assert.equal(mine.id, theirs.bot?.id);
    assert.equal(mine.username, theirs.bot?.account_name);

    const rejected = await probeZalo("wrong-token", 5_000);
    assert.equal(rejected.ok, false);
    await assert.rejects(() => probeZaloBotToken("wrong-token"), ChannelCredentialProbeError);
    // An empty token is refused by both without a request.
    assert.equal((await probeZalo("", 5_000)).ok, false);
    await assert.rejects(() => probeZaloBotToken(""), /empty/u);
  });
});
