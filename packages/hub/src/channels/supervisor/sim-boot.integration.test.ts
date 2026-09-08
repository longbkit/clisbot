// The channel plane end to end against simulated Slack and Telegram.
//
// Real: the database, the config revision, the installer, the loader, both
// verticals' built `dist/`, their SDKs (Bolt/Socket Mode, grammY), the ingress
// queue, the plane, the capability registry and the outbound path.
// Simulated: the chat platforms (loopback HTTP/ws) and the daemon.
//
// This is the tier the wave-4 live run needed and did not have. Every scenario
// below maps to a live scenario in `docs/tests/channels/p0-live-scenarios.md`,
// so a defect of the D-W4-0x class fails here first, in ~1 minute, with no
// credentials.
//
// Slow by design (a real boot per file). Set `RUN_CHANNEL_SIM_BOOT=1` to run it;
// `npm run test:sim-boot --workspace=@getpaseo/hub` does that for you.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelStore } from "../../db/channels.js";
import {
  SIM_ACCOUNT_ID,
  SIM_SLACK_CHANNEL,
  SIM_SLACK_SENDER,
  SIM_TELEGRAM_CHAT,
  SIM_TELEGRAM_SENDER,
  SIM_ORG_ID,
  startChannelSimBoot,
  type ChannelSimBoot,
} from "../../test-utils/channel-sim-boot.js";
import { listExecutableMessageActions } from "../channel-message-tool.js";
import { createChannelReplyServer } from "../channel-reply.js";
import { runChannelMessageAction } from "../message-actions.js";
import type { ChannelReplyBindingRef } from "../plane/types.js";

const ENABLED = process.env["RUN_CHANNEL_SIM_BOOT"] === "1";

// The streaming scenarios drive their own conversations. A root conversation
// that is already bound owns every thread/topic message under it — the plane
// answers an inbound from the binding's route before it matches text — so a
// topic of the chat the earlier scenarios bound would inherit their `tool`
// route, not the streaming one.
const STREAM_TELEGRAM_CHAT = -1_001_777_555;
const STREAM_SLACK_CHANNEL = "C_SIM_STREAM";

let boot: ChannelSimBoot;

beforeAll(async () => {
  if (!ENABLED) return;
  boot = await startChannelSimBoot();
}, 180_000);

afterAll(async () => {
  await boot?.close();
});

function telegramRef(): ChannelReplyBindingRef {
  return {
    channel: "telegram",
    accountId: SIM_ACCOUNT_ID,
    externalConversationId: String(SIM_TELEGRAM_CHAT),
    externalThreadId: null,
  };
}

function slackRef(threadTs: string | null): ChannelReplyBindingRef {
  return {
    channel: "slack",
    accountId: SIM_ACCOUNT_ID,
    externalConversationId: SIM_SLACK_CHANNEL,
    externalThreadId: threadTs,
  };
}

/** Recent Hub log lines, attached to an assertion so a failure names the cause
 * instead of leaving a silent empty array (2026-08-26 lesson rule 3). */
function recentLogs(count = 20): string[] {
  return boot.logs
    .slice(-count)
    .map((entry) => `${entry.level} ${entry.message} ${JSON.stringify(entry.meta)}`);
}

/** True once a marker reached the daemon in any turn frame. */
function daemonSawMarker(marker: string): boolean {
  return daemonPrompts().some((frame) => frame.includes(marker));
}

/** True once the vertical acked the envelope, which is what stops redelivery. */
function slackAcked(envelopeId: string): boolean {
  return boot.slack.acks().some((ack) => ack["envelope_id"] === envelopeId);
}

/** The agent the daemon ran the turn that carried `marker` on. A turn reaches
 * the daemon either as the prompt of a `create_agent_request` (which names no
 * agent yet — the daemon mints ids in create order, so the create's index is
 * the agent's) or as a `send_agent_message_request` on an existing agent. */
function agentIdForMarker(marker: string): string | undefined {
  let createIndex = -1;
  for (const message of boot.daemon.messages) {
    const isCreate = message["type"] === "create_agent_request";
    if (isCreate) createIndex += 1;
    if (!JSON.stringify(message).includes(marker)) continue;
    if (isCreate) return boot.daemon.createdAgentIds[createIndex];
    const agentId = message["agentId"];
    if (typeof agentId === "string") return agentId;
  }
  return undefined;
}

/** Polls `ready`, and on timeout fails with what the platform holds and what
 * the Hub logged — a streaming defect is invisible in the matcher alone. */
async function waitFor(
  ready: () => boolean,
  detail: () => string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out\n${detail()}\n${recentLogs(40).join("\n")}`);
}

/** Polls for that agent, and on timeout names what the Hub logged instead of
 * failing with a bare "expected undefined to be defined". */
async function agentForMarker(marker: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const agentId = agentIdForMarker(marker);
    if (agentId !== undefined) return agentId;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`no agent ran "${marker}"\n${recentLogs(40).join("\n")}`);
}

/** The prompt text a `create_agent_request` carried, for marker assertions. */
function daemonPrompts(): string[] {
  return boot.daemon
    .received("create_agent_request")
    .map((message) => JSON.stringify(message))
    .concat(boot.daemon.received("send_agent_message_request").map((m) => JSON.stringify(m)));
}

describe.runIf(ENABLED)("channel plane against simulated platforms", () => {
  it("starts both accounts with the real verticals against the sims", () => {
    const status = boot.supervisor.status();

    expect(
      status.map((entry) => [entry.channel, entry.transport, entry.loadTrace, entry.integrity]),
    ).toEqual([
      // `startAll` order — the accounts of the active revision, in file order.
      ["slack", "started", "ok", "ok"],
      ["telegram", "started", "ok", "ok"],
    ]);
    // Not "the code did not throw": the platforms saw the vertical arrive.
    expect(boot.slack.socketCount).toBe(1);
    expect(boot.telegram.recorder.count("/getMe")).toBeGreaterThan(0);
  });

  it("carries a Telegram group message through the queue to the daemon", async () => {
    const marker = "S27-SIM-TG-1 ping";

    boot.telegram.deliverMessage({
      chatId: SIM_TELEGRAM_CHAT,
      // A group message reaches the plane only when it addresses the bot: the
      // sim builds the `mention` entity Telegram would send.
      text: `@${boot.telegram.botUsername} ${marker}`,
      fromId: SIM_TELEGRAM_SENDER,
      chatType: "supergroup",
    });

    await expect.poll(() => daemonSawMarker(marker), { timeout: 30_000 }).toBe(true);
    // Admitted before the offset moved: a restart must not replay it.
    expect(boot.telegram.confirmedOffset).toBeGreaterThan(0);
  }, 60_000);

  it("carries a Slack channel mention through the real Socket Mode receiver", async () => {
    const marker = "S27-SIM-SL-1 ping";

    const envelopeId = boot.slack.deliverMention({
      channel: SIM_SLACK_CHANNEL,
      text: `<@${boot.slack.botUserId}> ${marker}`,
      user: SIM_SLACK_SENDER,
    });

    // The ack is the durable-admission proof: Slack only stops redelivering
    // once the vertical acks, and it acks after the Hub admitted the event.
    await expect.poll(() => slackAcked(envelopeId), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => daemonSawMarker(marker), { timeout: 30_000 }).toBe(true);
  }, 60_000);

  it("posts a channel reply that reads back from each platform", async () => {
    const telegramText = "S27-SIM-TG-2 PONG";
    const slackText = "S27-SIM-SL-2 PONG";

    const telegramPost = await boot.supervisor.channelReplyPost(telegramRef(), telegramText);
    const slackPost = await boot.supervisor.channelReplyPost(slackRef(null), slackText);

    expect(telegramPost.ok, `${JSON.stringify(telegramPost)} ${recentLogs().join(" | ")}`).toBe(
      true,
    );
    expect(slackPost.ok, JSON.stringify(slackPost)).toBe(true);
    expect(boot.telegram.transcript(SIM_TELEGRAM_CHAT).map((message) => message.text)).toContain(
      telegramText,
    );
    expect(boot.slack.transcript(SIM_SLACK_CHANNEL).map((message) => message.text)).toContain(
      slackText,
    );
  }, 60_000);

  // D-W4-04: `/help` was handled and never delivered. The only assertion that
  // catches that is the platform transcript, not the Hub's `handled: true`.
  it("delivers /help into the Telegram chat", async () => {
    const before = boot.telegram.transcript(SIM_TELEGRAM_CHAT).length;

    boot.telegram.deliverMessage({
      chatId: SIM_TELEGRAM_CHAT,
      text: "/help",
      fromId: SIM_TELEGRAM_SENDER,
      chatType: "supergroup",
    });

    await expect
      .poll(() => boot.telegram.transcript(SIM_TELEGRAM_CHAT).length > before, { timeout: 30_000 })
      .toBe(true);
    const posted = boot.telegram.transcript(SIM_TELEGRAM_CHAT).slice(before);
    expect(posted.map((message) => message.method)).toContain("sendMessage");
  }, 60_000);

  // D-W4-02: the schema advertised react/edit/pin and the live tool refused
  // everything except `send`, because no drive config was registered for the
  // account. Booting the account is what registers it.
  it("executes Slack react, edit and pin through the message tool", async () => {
    const slackScope = {
      organizationId: SIM_ORG_ID,
      channel: "slack",
      accountId: SIM_ACCOUNT_ID,
    };
    const executable = listExecutableMessageActions("slack", slackScope);
    expect(executable).toEqual(expect.arrayContaining(["send", "react", "edit", "pin"]));

    const posted = await boot.supervisor.channelReplyPost(slackRef(null), "S27-SIM-SL-3 before");
    expect(posted.ok, JSON.stringify(posted)).toBe(true);
    const ts = posted.externalMessageId;
    expect(ts, "the Slack post must report the ts the tool actions address").toBeDefined();
    const conversation = { to: SIM_SLACK_CHANNEL };
    const send = () => {
      throw new Error("the Hub send seam must not be used by react/edit/pin");
    };

    const react = await runChannelMessageAction({
      ...slackScope,
      action: "react",
      params: { messageId: ts, emoji: "eyes" },
      conversation,
      send,
    });
    const edit = await runChannelMessageAction({
      ...slackScope,
      action: "edit",
      params: { messageId: ts, message: "S27-SIM-SL-3 after" },
      conversation,
      send,
    });
    const pin = await runChannelMessageAction({
      ...slackScope,
      action: "pin",
      params: { messageId: ts },
      conversation,
      send,
    });

    expect([react.ok, edit.ok, pin.ok]).toEqual([true, true, true]);
    const message = boot.slack.transcript(SIM_SLACK_CHANNEL).find((entry) => entry.ts === ts);
    expect(message).toMatchObject({
      text: "S27-SIM-SL-3 after",
      edits: ["S27-SIM-SL-3 before"],
      pinned: true,
      reactions: { eyes: [boot.slack.botUserId] },
    });
  }, 60_000);

  // D-W4-03: `sync.streaming.mode: block` left an orphan draft stub beside the
  // answer. The proof is the platform transcript: ONE message in the topic, the
  // answer's full text, and the intermediate deltas visible as its edits.
  it("drafts a Telegram answer in place and leaves exactly one message", async () => {
    const marker = "S27-SIM-TG-5 stream";
    const topicId = 77;
    const inTopic = () =>
      boot.telegram
        .transcript(STREAM_TELEGRAM_CHAT)
        .filter((message) => message.message_thread_id === topicId);
    expect(inTopic()).toEqual([]);

    boot.telegram.deliverMessage({
      chatId: STREAM_TELEGRAM_CHAT,
      text: `@${boot.telegram.botUsername} ${marker}`,
      fromId: SIM_TELEGRAM_SENDER,
      chatType: "supergroup",
      messageThreadId: topicId,
    });
    const agentId = await agentForMarker(marker);

    // Three coalesced deltas of ONE assistant message, spaced past Telegram's
    // 1 s edit pacing so the draft actually pushes between them.
    await boot.daemon.streamTurn({
      agentId,
      deltas: ["Streaming…", " part two", " and the end"],
      gapMs: 1_200,
    });

    await waitFor(
      () => inTopic().at(0)?.text.includes("Streaming… part two and the end") === true,
      () => `topic ${topicId}: ${JSON.stringify(boot.telegram.transcript(STREAM_TELEGRAM_CHAT))}`,
    );
    const posted = inTopic();
    expect(
      posted.map((message) => message.method),
      recentLogs().join(" | "),
    ).toEqual(["sendMessage"]);
    // The draft was edited in place before the final text landed on it.
    expect(posted[0]?.edits.length).toBeGreaterThan(0);
  }, 120_000);

  // The other streaming mode: Slack renders progress as a Block Kit card posted
  // while the turn runs, not as the answer.
  it("posts a Slack progress card while the turn runs", async () => {
    const marker = "S27-SIM-SL-4 stream";
    const rootTs = "1757200000.000500";

    boot.slack.deliverMention({
      channel: STREAM_SLACK_CHANNEL,
      text: `<@${boot.slack.botUserId}> ${marker}`,
      user: SIM_SLACK_SENDER,
      threadTs: rootTs,
    });
    const agentId = await agentForMarker(marker);

    await boot.daemon.streamTurn({
      agentId,
      toolName: "bash",
      deltas: ["Slack answer"],
    });

    const progressCard = () =>
      boot.slack.thread(STREAM_SLACK_CHANNEL, rootTs).find((post) => post.blocks !== undefined);
    await waitFor(
      () => progressCard() !== undefined,
      () => `thread ${rootTs}: ${JSON.stringify(boot.slack.transcript(STREAM_SLACK_CHANNEL))}`,
    );
    const card = progressCard();
    expect(JSON.stringify(card?.blocks), recentLogs().join(" | ")).toContain("bash");
  }, 120_000);

  // D-W4-01: the reply capability lived only in process memory, so after a Hub
  // restart `tools/list` answered 200 with an EMPTY tool list and every reply
  // was swallowed. The restart here is the real one: a second supervisor over
  // the same database and data dir.
  it("keeps the reply capability usable across a Hub restart", async () => {
    const capabilities = boot.supervisor.channelReplyCapabilities;
    expect(capabilities).toBeDefined();
    const token = capabilities?.issue({
      organizationId: SIM_ORG_ID,
      channelRevisionId: null,
      routePosition: 0,
      routeFingerprint: "sim-route",
      ref: telegramRef(),
    }) as string;
    expect(capabilities?.bind(token, "agent-sim-1")).toBe(true);
    await capabilities?.flush?.();

    await boot.restart();

    const restored = boot.supervisor.channelReplyCapabilities;
    expect(restored?.resolve(token, SIM_ORG_ID)?.agentId).toBe("agent-sim-1");
    const server = createChannelReplyServer({
      organizationId: SIM_ORG_ID,
      store: new ChannelStore(boot.bundle.runtime),
      resolveCapability: (candidate) => restored?.resolve(candidate, SIM_ORG_ID),
      post: (ref, text) => boot.supervisor.channelReplyPost(ref, text),
    });
    const response = await server.handle(
      new Request(`https://hub.test/mcp/channel/${token}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
      token,
    );
    const listed = (await response.json()) as { result?: { tools?: { name: string }[] } };

    expect(
      (listed.result?.tools ?? []).map((tool) => tool.name),
      JSON.stringify(listed),
    ).toContain("message");

    // Exactly once: a post through the restored capability lands one message.
    const before = boot.telegram.transcript(SIM_TELEGRAM_CHAT).length;
    const result = await boot.supervisor.channelReplyPost(
      telegramRef(),
      "S27-SIM-TG-4 after restart",
    );
    expect(result.ok).toBe(true);
    expect(boot.telegram.transcript(SIM_TELEGRAM_CHAT).length).toBe(before + 1);
  }, 120_000);
});
