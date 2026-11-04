import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { DaemonSessionChannel } from "../../daemons/protocol.js";
import { connectEnrolledChannelDaemon, type DaemonConnection } from "./client.js";
import { HostTimelineSubscription } from "./host-timeline-subscription.js";

/**
 * A Host's own socket as the daemon sees it: one session source, and the Hub
 * declares no `owned_subscriptions`, so it keeps ONE timeline set and every
 * `agent.timeline.set_subscription.request` replaces it. A new socket starts
 * with none. Only agents in the set have their streams delivered.
 */
class OneSlotHost {
  connected = true;
  /** The timeline set of the socket that is live now. */
  timeline: string[] = [];
  /** Timeline writes that reached the Host. */
  writes = 0;
  private readonly frameHandlers = new Set<(message: Record<string, unknown>) => void>();
  private readonly connectedHandlers = new Set<() => void>();
  private readonly disconnectedHandlers = new Set<() => void>();

  readonly channel: DaemonSessionChannel = {
    serverInfo: { serverId: "host-1", features: {} },
    permissions: [],
    write: async (frame) => {
      const message = (JSON.parse(frame) as { message: Record<string, unknown> }).message;
      if (message["type"] !== "agent.timeline.set_subscription.request") return;
      this.writes += 1;
      this.timeline = [...(message["agentIds"] as string[])];
      queueMicrotask(() =>
        this.emit({
          type: "agent.timeline.set_subscription.response",
          payload: { requestId: message["requestId"], agentIds: this.timeline },
        }),
      );
    },
  };

  connect(
    account: string,
    onStream: (agentId: string) => void,
    shared?: HostTimelineSubscription,
  ): DaemonConnection {
    return connectEnrolledChannelDaemon({
      hostLabel: "host-1",
      hostId: "host-1",
      resolveChannel: () => (this.connected ? this.channel : undefined),
      subscribe: (handler) => {
        this.frameHandlers.add(handler);
        return () => this.frameHandlers.delete(handler);
      },
      onHostConnected: (handler) => {
        this.connectedHandlers.add(handler);
        return () => this.connectedHandlers.delete(handler);
      },
      onHostDisconnected: (handler) => {
        this.disconnectedHandlers.add(handler);
        return () => this.disconnectedHandlers.delete(handler);
      },
      onStream: ({ agentId }) => onStream(agentId),
      ...(shared === undefined ? {} : { timeline: { shared, clientKey: account } }),
    });
  }

  /** The agent produced output: delivered only if the socket subscribes to it. */
  stream(agentId: string): void {
    if (!this.timeline.includes(agentId)) return;
    this.emit({ type: "agent_stream", payload: { agentId, event: { type: "timeline" } } });
  }

  /** The socket dropped and a new one came up, holding no timeline set. */
  reconnect(): void {
    this.connected = false;
    for (const handler of this.disconnectedHandlers) handler();
    this.timeline = [];
    this.connected = true;
    for (const handler of this.connectedHandlers) handler();
  }

  private emit(message: Record<string, unknown>): void {
    for (const handler of this.frameHandlers) handler(message);
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the timeline set of a Host shared by several channel accounts", () => {
  it("baseline without the shared set: another account's stop cuts a running Slack turn off", async () => {
    // The 2026-11-03 trace, as it was: Telegram's restart loop sent [] and the
    // Slack turn's answer never arrived.
    const host = new OneSlotHost();
    const slackSeen: string[] = [];
    const slack = host.connect("slack:bot", (id) => slackSeen.push(id), undefined);
    const telegram = host.connect("telegram:bot", () => undefined, undefined);
    await slack.setTimelineSubscription(["slack-agent"]);
    await telegram.setTimelineSubscription([]);
    host.stream("slack-agent");
    await settle();
    assert.deepEqual(slackSeen, []);
    slack.stop();
    telegram.stop();
  });

  it("keeps a running Slack turn streaming while another account stops and restarts", async () => {
    const host = new OneSlotHost();
    const shared = new HostTimelineSubscription();
    const slackSeen: string[] = [];
    const slack = host.connect("slack:bot", (id) => slackSeen.push(id), shared);
    let telegram = host.connect("telegram:bot", () => undefined, shared);
    await slack.setTimelineSubscription(["slack-agent"]);
    await telegram.setTimelineSubscription(["telegram-agent"]);
    assert.deepEqual(host.timeline, ["slack-agent", "telegram-agent"]);

    // `plane.stop()`: the account clears its own set, then drops the socket.
    await telegram.setTimelineSubscription([]);
    telegram.stop();
    telegram = host.connect("telegram:bot", () => undefined, shared);
    await telegram.setTimelineSubscription([]);

    assert.deepEqual(host.timeline, ["slack-agent"]);
    host.stream("slack-agent");
    await settle();
    assert.deepEqual(slackSeen, ["slack-agent"]);
    slack.stop();
    telegram.stop();
  });

  it("sends the set again when the Host's socket comes back", async () => {
    const host = new OneSlotHost();
    const shared = new HostTimelineSubscription();
    const slackSeen: string[] = [];
    const slack = host.connect("slack:bot", (id) => slackSeen.push(id), shared);
    await slack.setTimelineSubscription(["slack-agent"]);

    host.reconnect();
    await settle();
    assert.deepEqual(host.timeline, ["slack-agent"]);
    host.stream("slack-agent");
    await settle();
    assert.deepEqual(slackSeen, ["slack-agent"]);
    slack.stop();
  });

  it("drops a stopped account's agents from the next write, even when its own clear failed", async () => {
    const host = new OneSlotHost();
    const shared = new HostTimelineSubscription();
    const slack = host.connect("slack:bot", () => undefined, shared);
    const telegram = host.connect("telegram:bot", () => undefined, shared);
    await slack.setTimelineSubscription(["slack-agent"]);
    await telegram.setTimelineSubscription(["telegram-agent"]);

    host.connected = false;
    await assert.rejects(telegram.setTimelineSubscription([]));
    telegram.stop();
    host.connected = true;
    await slack.setTimelineSubscription(["slack-agent", "slack-agent-2"]);
    assert.deepEqual(host.timeline, ["slack-agent", "slack-agent-2"]);
    slack.stop();
  });

  it("leaves a stopped account out after a reconnect when its own clear never reached the Host", async () => {
    const host = new OneSlotHost();
    const shared = new HostTimelineSubscription();
    const slackSeen: string[] = [];
    const slack = host.connect("slack:bot#1", (id) => slackSeen.push(id), shared);
    const telegram = host.connect("telegram:bot#2", () => undefined, shared);
    await slack.setTimelineSubscription(["slack-agent"]);
    await telegram.setTimelineSubscription(["telegram-agent"]);

    // The Host is away when Telegram's plane stops: its [] fails before `forget`.
    host.connected = false;
    await assert.rejects(telegram.setTimelineSubscription([]));
    telegram.stop();
    host.reconnect();
    await settle();

    assert.deepEqual(host.timeline, ["slack-agent"]);
    host.stream("slack-agent");
    await settle();
    assert.deepEqual(slackSeen, ["slack-agent"]);
    slack.stop();
  });

  it("sends nothing on reconnect once its only account has stopped", async () => {
    const host = new OneSlotHost();
    const shared = new HostTimelineSubscription();
    const telegram = host.connect("telegram:bot#1", () => undefined, shared);
    await telegram.setTimelineSubscription(["telegram-agent"]);
    host.connected = false;
    await assert.rejects(telegram.setTimelineSubscription([]));
    telegram.stop();
    const writes = host.writes;
    host.reconnect();
    await settle();
    assert.equal(host.writes, writes);
    assert.deepEqual(host.timeline, []);
  });

  it("keeps a restarted account's new connection when the old one stops after it", async () => {
    const host = new OneSlotHost();
    const shared = new HostTimelineSubscription();
    const old = host.connect("telegram:bot#1", () => undefined, shared);
    await old.setTimelineSubscription(["old-agent"]);
    const fresh = host.connect("telegram:bot#2", () => undefined, shared);
    await fresh.setTimelineSubscription(["new-agent"]);

    host.connected = false;
    await assert.rejects(old.setTimelineSubscription([]));
    old.stop();
    host.reconnect();
    await settle();
    assert.deepEqual(host.timeline, ["new-agent"]);
    fresh.stop();
  });

  it("writes in order with the union as it is when each write runs", async () => {
    const shared = new HostTimelineSubscription();
    const written: string[][] = [];
    const write = async (ids: readonly string[]) => {
      await settle();
      written.push([...ids]);
    };
    await Promise.all([
      shared.set("a", ["1"], write),
      shared.set("b", ["2"], write),
      shared.set("a", [], write),
    ]);
    assert.deepEqual(written.at(-1), ["2"]);
    await shared.resend(write);
    assert.deepEqual(written.at(-1), ["2"]);
  });
});
