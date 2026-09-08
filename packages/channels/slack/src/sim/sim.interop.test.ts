// The Slack sim, proven against the REAL @slack/web-api and @slack/socket-mode.
//
// Rule 1 of docs/lessons/2026-08-26-integration-seams-before-live-e2e.md: spike
// the external contract before building on it. Every hub-level sim-boot test
// trusts this harness, so the harness is verified against the SDKs the vertical
// actually loads — not against a description of the Slack API.
import { SocketModeClient } from "@slack/socket-mode";
import { ErrorCode, WebClient, type WebAPICallError } from "@slack/web-api";
import { afterEach, describe, expect, it } from "vitest";
import { startSlackSim, type SimSlack } from "@getpaseo/channels-shared/sim";

let sim: SimSlack | undefined;
let socket: SocketModeClient | undefined;

afterEach(async () => {
  await socket?.disconnect().catch(() => undefined);
  socket = undefined;
  await sim?.close();
  sim = undefined;
});

async function startSim(): Promise<SimSlack> {
  sim = await startSlackSim();
  return sim;
}

function web(active: SimSlack): WebClient {
  return new WebClient(active.botToken, {
    slackApiUrl: active.apiUrl,
    retryConfig: { retries: 0 },
  });
}

describe("Slack sim over the real Web API client", () => {
  it("answers auth.test with the configured identity", async () => {
    const active = await startSim();

    const result = await web(active).auth.test();

    expect(result).toMatchObject({
      ok: true,
      team_id: active.teamId,
      user_id: active.botUserId,
      bot_id: active.botId,
    });
  });

  it("records chat.postMessage and reads the thread back", async () => {
    const active = await startSim();
    const client = web(active);
    const root = await client.chat.postMessage({ channel: "C_SIM", text: "root" });

    await client.chat.postMessage({ channel: "C_SIM", text: "reply", thread_ts: root.ts });

    expect(active.calls("chat.postMessage")).toEqual([
      { channel: "C_SIM", text: "root" },
      { channel: "C_SIM", text: "reply", thread_ts: root.ts },
    ]);
    const replies = await client.conversations.replies({ channel: "C_SIM", ts: String(root.ts) });
    expect((replies.messages ?? []).map((message) => message.text)).toEqual(["root", "reply"]);
  });

  it("applies react, edit and pin to the stored message", async () => {
    const active = await startSim();
    const client = web(active);
    const posted = await client.chat.postMessage({ channel: "C_SIM", text: "before" });
    const ts = String(posted.ts);

    await client.reactions.add({ channel: "C_SIM", timestamp: ts, name: "eyes" });
    await client.chat.update({ channel: "C_SIM", ts, text: "after" });
    await client.pins.add({ channel: "C_SIM", timestamp: ts });

    expect(active.transcript("C_SIM")[0]).toMatchObject({
      text: "after",
      edits: ["before"],
      pinned: true,
      reactions: { eyes: [active.botUserId] },
    });
  });

  it("hands a Socket Mode client an envelope and records its ack", async () => {
    const active = await startSim();
    socket = new SocketModeClient({
      appToken: active.appToken,
      clientOptions: { slackApiUrl: active.apiUrl },
    });
    const received: unknown[] = [];
    socket.on("message", async ({ event, ack }: { event?: unknown; ack?: () => Promise<void> }) => {
      received.push(event);
      await ack?.();
    });
    await socket.start();
    await active.waitForSocket();

    const envelopeId = active.deliverMention({
      channel: "C_SIM",
      text: "<@U_SIM_BOT> ping",
      user: "U_HUMAN",
    });

    // The SDK acks with `{envelope_id, payload}` — payload is `{}` for an ack
    // that carries no response body.
    await expect
      .poll(() => active.acks(), { timeout: 10_000 })
      .toEqual([{ envelope_id: envelopeId, payload: {} }]);
    expect(received).toHaveLength(1);
  }, 20_000);

  it("makes the SDK's own 429 retry run for real", async () => {
    const active = await startSim();
    // Default retryConfig: the point is that the SDK's backoff path executes.
    const client = new WebClient(active.botToken, { slackApiUrl: active.apiUrl });
    active.injectFault({
      match: "chat.postMessage",
      fault: { kind: "rate-limit", retryAfterSeconds: 1 },
    });

    await expect(
      client.chat.postMessage({ channel: "C_SIM", text: "throttled" }),
    ).resolves.toMatchObject({
      ok: true,
    });

    // The fault is one-shot, so exactly one retry followed the 429.
    expect(active.recorder.count("chat.postMessage")).toBe(2);
    expect(active.transcript("C_SIM")).toHaveLength(1);
  }, 20_000);

  it("surfaces a 5xx as an HTTP error once retries are off", async () => {
    const active = await startSim();
    active.injectFault({ match: "chat.postMessage", fault: { kind: "server-error", status: 503 } });

    const error = (await web(active)
      .chat.postMessage({ channel: "C_SIM", text: "boom" })
      .catch((cause: unknown) => cause)) as WebAPICallError;

    expect(error.code).toBe(ErrorCode.HTTPError);
  });

  it("surfaces an injected invalid_auth as a platform error", async () => {
    const active = await startSim();
    active.injectFault({ match: "auth.test", fault: { kind: "unauthorized" } });

    const error = (await web(active)
      .auth.test()
      .catch((cause: unknown) => cause)) as WebAPICallError & { data?: { error?: string } };

    expect(error.code).toBe(ErrorCode.PlatformError);
    expect(error.data?.error).toBe("invalid_auth");
  });

  it("drops the live socket so a reconnect path is reachable", async () => {
    const active = await startSim();
    socket = new SocketModeClient({
      appToken: active.appToken,
      clientOptions: { slackApiUrl: active.apiUrl },
    });
    await socket.start();
    await active.waitForSocket();
    expect(active.openCount).toBe(1);

    active.dropSocket();

    // The SDK reconnects by calling apps.connections.open again.
    await expect.poll(() => active.openCount, { timeout: 20_000 }).toBeGreaterThan(1);
  }, 30_000);
});
