// The Discord sim, proven against the REAL ported Discord client and gateway.
//
// Rule 1 of docs/lessons/2026-08-26-integration-seams-before-live-e2e.md: spike
// the external contract before building on it. Discord's client is in-repo
// (`internal/rest.ts`, `internal/gateway.ts`) rather than a vendored SDK, which
// makes the seam easier to fake and therefore easier to fake WRONG — the 429
// backoff, the bucket headers and the HELLO/IDENTIFY/READY handshake all live in
// our own code, so nothing external would catch a sim that got them close but
// not right. These cases drive that code, unmodified, against the sim.
import { afterEach, describe, expect, it } from "vitest";
import { startDiscordSim, type SimDiscord } from "@getpaseo/channels-shared/sim";
import type { APIMessage, APIUser } from "discord-api-types/v10";
import { Client } from "../internal/client.js";
import { GatewayIntents, GatewayPlugin } from "../internal/gateway.js";
import { MessageCreateListener } from "../internal/listeners.js";
import { DiscordError, RateLimitError, RequestClient } from "../internal/rest.js";

const CHANNEL = "400000000000000004";
const GUILD = "500000000000000005";
const HUMAN = "200000000000000002";

let sim: SimDiscord | undefined;
let gateway: GatewayPlugin | undefined;

afterEach(async () => {
  gateway?.disconnect();
  gateway = undefined;
  await sim?.close();
  sim = undefined;
});

async function startSim(options: Parameters<typeof startDiscordSim>[0] = {}): Promise<SimDiscord> {
  sim = await startDiscordSim(options);
  return sim;
}

/** The ported REST client, pointed at the sim. `queueRequests` stays on: the
 * scheduler IS the retry path these cases are here to exercise. */
function rest(active: SimDiscord, overrides: { queueRequests?: boolean } = {}): RequestClient {
  return new RequestClient(active.token, { baseUrl: active.restUrl, ...overrides });
}

/** A Client hosting a real GatewayPlugin aimed at the sim's ws endpoint. */
function connect(active: SimDiscord, onMessage: (message: APIMessage) => void): Client {
  class TestListener extends MessageCreateListener {
    override handle(data: APIMessage): void {
      onMessage(data);
    }
  }
  gateway = new GatewayPlugin({
    url: active.gatewayUrl,
    intents: GatewayIntents.Guilds | GatewayIntents.GuildMessages | GatewayIntents.MessageContent,
    autoInteractions: false,
    reconnect: { maxAttempts: 5 },
  });
  return new Client(
    {
      baseUrl: "",
      clientId: active.applicationId,
      publicKey: "",
      token: active.token,
      autoDeploy: false,
      disableDeployRoute: true,
      disableInteractionsRoute: true,
      disableEventsRoute: true,
      requestOptions: { baseUrl: active.restUrl },
    },
    { listeners: [new TestListener()] },
    [gateway],
  );
}

describe("Discord sim over the real ported REST client", () => {
  it("answers /users/@me with the configured bot identity", async () => {
    const active = await startSim();

    const me = (await rest(active).get("/users/@me")) as APIUser;

    expect(me).toMatchObject({ id: active.botUserId, bot: true });
    // The client joins baseUrl with `/v{apiVersion}` before every route.
    expect(active.requests().at(-1)?.path).toBe("/v10/users/@me");
  });

  it("records a message send and reads the channel back", async () => {
    const active = await startSim();
    const client = rest(active);

    const posted = (await client.post(`/channels/${CHANNEL}/messages`, {
      body: { content: "root" },
    })) as APIMessage;
    await client.post(`/channels/${CHANNEL}/messages`, {
      body: { content: "reply", message_reference: { message_id: posted.id } },
    });

    expect(active.calls(`/channels/${CHANNEL}/messages`)).toEqual([
      { content: "root" },
      { content: "reply", message_reference: { message_id: posted.id } },
    ]);
    // Read-back, not an assertion on the request just made: Discord lists a
    // channel newest-first.
    const listed = (await client.get(`/channels/${CHANNEL}/messages`)) as APIMessage[];
    expect(listed.map((message) => message.content)).toEqual(["reply", "root"]);
    expect(active.messages()).toHaveLength(2);
  });

  it("applies an edit and an own-reaction to the stored message", async () => {
    const active = await startSim();
    const client = rest(active);
    const posted = (await client.post(`/channels/${CHANNEL}/messages`, {
      body: { content: "before" },
    })) as APIMessage;

    await client.patch(`/channels/${CHANNEL}/messages/${posted.id}`, { body: { content: "after" } });
    await client.put(
      `/channels/${CHANNEL}/messages/${posted.id}/reactions/${encodeURIComponent("👀")}/@me`,
    );

    expect(active.transcript(CHANNEL)[0]).toMatchObject({
      content: "after",
      edits: ["before"],
      reactions: { "👀": [active.botUserId] },
    });
  });

  it("makes the scheduler's own 429 retry run for real", async () => {
    const active = await startSim();
    // Default options: `maxRateLimitRetries` is 3 and the requeue waits on the
    // bucket reset the 429 headers announce.
    const client = rest(active);
    active.injectFault({
      match: `/channels/${CHANNEL}/messages`,
      fault: { kind: "rate-limit", retryAfterSeconds: 0.2 },
    });

    await expect(
      client.post(`/channels/${CHANNEL}/messages`, { body: { content: "throttled" } }),
    ).resolves.toMatchObject({ content: "throttled" });

    // The fault is one-shot, so exactly one retry followed the 429.
    expect(active.recorder.count(`/channels/${CHANNEL}/messages`)).toBe(2);
    expect(active.transcript(CHANNEL)).toHaveLength(1);
  }, 20_000);

  it("surfaces an exhausted 429 as the vertical's RateLimitError", async () => {
    const active = await startSim();
    // Retries off: the caller sees the classified error rather than a retry.
    const client = new RequestClient(active.token, {
      baseUrl: active.restUrl,
      queueRequests: false,
    });
    active.injectFault({
      match: `/channels/${CHANNEL}/messages`,
      fault: { kind: "rate-limit", retryAfterSeconds: 3 },
    });

    const error = await client
      .post(`/channels/${CHANNEL}/messages`, { body: { content: "throttled" } })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(3);
    expect((error as RateLimitError).status).toBe(429);
    // The bucket header is hashed, never echoed raw, but it must be present.
    expect((error as RateLimitError).bucket).toEqual(expect.any(String));
  });

  it("surfaces an injected 401 as the vertical's DiscordError", async () => {
    const active = await startSim();
    active.injectFault({ match: "/users/@me", fault: { kind: "unauthorized" } });

    const error = await rest(active)
      .get("/users/@me")
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DiscordError);
    expect((error as DiscordError).status).toBe(401);
    expect((error as DiscordError).message).toContain("Unauthorized");
  });

  it("surfaces a 5xx as a DiscordError carrying the status", async () => {
    const active = await startSim();
    active.injectFault({
      match: `/channels/${CHANNEL}/messages`,
      fault: { kind: "server-error", status: 503 },
    });

    const error = await rest(active)
      .post(`/channels/${CHANNEL}/messages`, { body: { content: "boom" } })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DiscordError);
    expect((error as DiscordError).status).toBe(503);
  });
});

describe("Discord sim over the real ported gateway", () => {
  it("completes IDENTIFY, heartbeats, and lands a MESSAGE_CREATE on a listener", async () => {
    // A short HELLO interval makes the real heartbeat loop run inside the test.
    const active = await startSim({ heartbeatIntervalMs: 60 });
    const received: APIMessage[] = [];
    connect(active, (message) => received.push(message));
    await active.waitForIdentify();

    expect(active.identifies()[0]).toMatchObject({ token: active.token });
    // READY is what arms the resume state and the connected flag.
    await expect.poll(() => gateway?.isConnected, { timeout: 10_000 }).toBe(true);
    // op 1 out, op 11 back: without the ack the plugin declares a zombie socket.
    await expect
      .poll(() => active.gatewaySends().filter((frame) => frame.op === 1).length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    const messageId = active.deliverMessage({
      channelId: CHANNEL,
      guildId: GUILD,
      authorId: HUMAN,
      content: "S-SIM-DISCORD ping",
      mentions: [active.botUserId],
    });

    await expect.poll(() => received.map((message) => message.id), { timeout: 10_000 }).toEqual([
      messageId,
    ]);
    expect(received[0]?.content).toBe("S-SIM-DISCORD ping");
    expect(active.socketCount).toBe(1);
  }, 30_000);

  it("drops the live socket so the reconnect path is reachable", async () => {
    const active = await startSim();
    connect(active, () => undefined);
    await active.waitForIdentify();
    await expect.poll(() => gateway?.isConnected, { timeout: 10_000 }).toBe(true);

    active.dropSocket();

    // 1006 is resumable, so the plugin comes back with op 6 RESUME carrying the
    // session READY handed it — not a second IDENTIFY.
    await expect
      .poll(() => active.gatewaySends().filter((frame) => frame.op === 6).length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect.poll(() => active.socketCount, { timeout: 20_000 }).toBe(1);
    expect(active.identifies()).toHaveLength(1);
  }, 40_000);
});
