import { expect, test } from "vitest";
import { createAgentMessageDelivery, parseAgentMessages } from "./index.js";
import {
  currentSessionOperationIdentity,
  withSessionOperationIdentity,
  type SessionOperationContext,
} from "../session-operation-context.js";
import type { AgentPromptInput } from "../agent-sdk-types.js";

function createClock() {
  let now = 0;
  const jobs = new Map<() => void, number>();
  return {
    schedule(delayMs: number, callback: () => void) {
      jobs.set(callback, now + delayMs);
      return () => {
        jobs.delete(callback);
      };
    },
    advance(ms: number) {
      now += ms;
      for (const [callback, deadline] of jobs) {
        if (deadline > now) continue;
        jobs.delete(callback);
        callback();
      }
    },
  };
}

test("a queued child report and completion reach the recipient in one steer after two quiet seconds", async () => {
  const clock = createClock();
  const sent: Array<{ recipientId: string; prompt: AgentPromptInput }> = [];
  const delivery = createAgentMessageDelivery({
    schedule: clock.schedule,
    dispatch: async (batch) => {
      sent.push(batch);
      return "steered";
    },
    onError: (error) => {
      throw error;
    },
  });
  const receipt = delivery.enqueue({
    recipientId: "parent",
    messageId: "report",
    prompt: "Results <ready>",
    source: { kind: "agent-message", agentId: "worker" },
  });
  expect(receipt).toMatchObject({ status: "queued", messageId: "report" });
  expect(sent).toEqual([]);
  clock.advance(1000);
  delivery.enqueue({
    recipientId: "parent",
    messageId: "finish",
    prompt: "Worker finished",
    source: { kind: "agent-notification", agentId: "worker", event: "finished" },
  });
  clock.advance(1999);
  expect(sent).toEqual([]);
  clock.advance(1);
  await delivery.close();
  expect(
    sent.map((batch) => ({
      recipientId: batch.recipientId,
      messages: parseAgentMessages(String(batch.prompt)),
    })),
  ).toEqual([
    {
      recipientId: "parent",
      messages: [
        {
          id: "report",
          source: { kind: "agent-message", agentId: "worker" },
          text: "Results <ready>",
        },
        {
          id: "finish",
          source: { kind: "agent-notification", agentId: "worker", event: "finished" },
          text: "Worker finished",
        },
      ],
    },
  ]);
});

test("recipient timers are independent, later messages form another batch, and close flushes pending work", async () => {
  const clock = createClock();
  const sent: string[] = [];
  const delivery = createAgentMessageDelivery({
    schedule: clock.schedule,
    dispatch: async (request) => {
      sent.push(`${request.recipientId}:${request.messageIds.join(",")}`);
      return "steered";
    },
    onError: (error) => {
      throw error;
    },
  });
  const source = { kind: "agent-message" as const, agentId: "worker" };
  const a = delivery.enqueue({ recipientId: "a", messageId: "first", source, prompt: "one" });
  clock.advance(1000);
  const b = delivery.enqueue({ recipientId: "b", messageId: "independent", source, prompt: "two" });
  clock.advance(1000);
  await a.dispatched;
  expect(sent).toEqual(["a:first"]);
  delivery.enqueue({ recipientId: "a", messageId: "later", source, prompt: "three" });
  clock.advance(1000);
  await b.dispatched;
  expect(sent).toEqual(["a:first", "b:independent"]);
  await delivery.close();
  expect(sent).toEqual(["a:first", "b:independent", "a:later"]);
  expect(() => delivery.enqueue({ recipientId: "a", source, prompt: "closed" })).toThrow("closed");
});

test("explicit interrupt and conflicting session modes retain ordered dispatch boundaries", async () => {
  const sent: Array<{
    activeTurnBehavior: string;
    sessionMode?: string;
    messageIds: readonly string[];
  }> = [];
  const delivery = createAgentMessageDelivery({
    dispatch: async (request) => {
      sent.push(request);
      request.onDispatch("steered");
      return "steered";
    },
    onError: (error) => {
      throw error;
    },
  });
  const source = { kind: "agent-message" as const, agentId: "worker" };
  delivery.enqueue({
    recipientId: "parent",
    source,
    prompt: "interrupt",
    messageId: "interrupt",
    activeTurnBehavior: "interrupt",
  });
  delivery.enqueue({
    recipientId: "parent",
    source,
    prompt: "review",
    messageId: "review",
    sessionMode: "plan",
  });
  delivery.enqueue({
    recipientId: "parent",
    source,
    prompt: "execute",
    messageId: "execute",
    sessionMode: "full-access",
  });
  delivery.enqueue({
    recipientId: "parent",
    source: { kind: "agent-notification", agentId: "worker", event: "finished" },
    prompt: "done",
    messageId: "finished",
  });
  await delivery.close();
  expect(
    sent.map(({ activeTurnBehavior, sessionMode, messageIds }) => ({
      activeTurnBehavior,
      sessionMode,
      messageIds,
    })),
  ).toEqual([
    { activeTurnBehavior: "interrupt", sessionMode: undefined, messageIds: ["interrupt"] },
    { activeTurnBehavior: "steer", sessionMode: "plan", messageIds: ["review"] },
    {
      activeTurnBehavior: "steer",
      sessionMode: "full-access",
      messageIds: ["execute", "finished"],
    },
  ]);
});

test("dispatch failures reject waits before and after flush and do not poison later messages", async () => {
  const clock = createClock();
  const failed = new Error("provider rejected");
  const errors: unknown[] = [];
  const delivery = createAgentMessageDelivery({
    schedule: clock.schedule,
    dispatch: async (request) => {
      if (request.messageIds.includes("bad")) throw failed;
      return "steered";
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  const message = {
    recipientId: "parent",
    source: { kind: "agent-message" as const, agentId: "worker" },
    prompt: "report",
  };
  const bad = delivery.enqueue({ ...message, messageId: "bad" });
  const before = expect(
    delivery.waitForDispatch("parent", new AbortController().signal),
  ).rejects.toBe(failed);
  clock.advance(2000);
  const after = expect(
    delivery.waitForDispatch("parent", new AbortController().signal),
  ).rejects.toBe(failed);
  await Promise.all([before, after, expect(bad.dispatched).rejects.toBe(failed)]);
  const next = delivery.enqueue({ ...message, messageId: "next" });
  await delivery.close();
  await expect(next.dispatched).resolves.toBe("steered");
  expect(errors).toEqual([failed]);
});

test("canceling a completion wait leaves queued delivery intact", async () => {
  const clock = createClock();
  const delivery = createAgentMessageDelivery({
    schedule: clock.schedule,
    dispatch: async () => "steered",
    onError: (error) => {
      throw error;
    },
  });
  const receipt = delivery.enqueue({
    recipientId: "parent",
    source: { kind: "agent-message", agentId: "worker" },
    prompt: "report",
  });
  const controller = new AbortController();
  const wait = delivery.waitForDispatch("parent", controller.signal);
  controller.abort();
  await expect(wait).rejects.toMatchObject({ name: "AbortError" });
  await delivery.close();
  await expect(receipt.dispatched).resolves.toBe("steered");
});

test("batches retain each sender's attachment context and image order", async () => {
  let prompt: AgentPromptInput = "";
  const delivery = createAgentMessageDelivery({
    dispatch: async (request) => {
      prompt = request.prompt;
      return "steered";
    },
    onError: (error) => {
      throw error;
    },
  });
  const firstImage = { type: "image" as const, data: "Zmlyc3Q=", mimeType: "image/png" };
  const secondImage = { type: "image" as const, data: "c2Vjb25k", mimeType: "image/png" };
  delivery.enqueue({
    recipientId: "parent",
    messageId: "first",
    source: { kind: "agent-message", agentId: "one" },
    prompt: [{ type: "text", text: "First" }, firstImage],
  });
  delivery.enqueue({
    recipientId: "parent",
    messageId: "second",
    source: { kind: "agent-message", agentId: "two" },
    prompt: [
      { type: "text", text: "Second" },
      {
        type: "github_issue",
        mimeType: "application/github-issue",
        number: 42,
        title: "Context",
        url: "https://example.com/42",
        body: "Attached",
      },
      secondImage,
    ],
  });
  await delivery.close();
  expect(prompt).toEqual([
    {
      type: "text",
      text: '<clisbot-system version="1" kind="agent-message" source-agent-id="one" message-id="first">\nFirst\n</clisbot-system>',
    },
    firstImage,
    {
      type: "text",
      text: '<clisbot-system version="1" kind="agent-message" source-agent-id="two" message-id="second">\nSecond\n\nGitHub Issue #42: Context\nhttps://example.com/42\n\nAttached\n</clisbot-system>',
    },
    secondImage,
  ]);
  expect(
    parseAgentMessages(
      (prompt as Exclude<AgentPromptInput, string>)
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n"),
    )?.map((message) => message.source?.agentId),
  ).toEqual(["one", "two"]);
});

test("queued messages preserve each trusted identity through shutdown without batching different actors or channels", async () => {
  const sent: Array<{ ids: readonly string[]; identity?: SessionOperationContext }> = [];
  const delivery = createAgentMessageDelivery({
    dispatch: async (batch) => {
      sent.push({
        ids: batch.messageIds,
        identity: structuredClone(currentSessionOperationIdentity()),
      });
      return "steered";
    },
    onError: (error) => {
      throw error;
    },
  });
  const receivedAt = "2026-10-24T12:00:00.000Z";
  const channel = {
    hubOrigin: "https://hub.example",
    organizationId: "org",
    connectionId: "slack",
    channelId: "a",
  };
  const enqueue = (id: string) =>
    delivery.enqueue({
      recipientId: "parent",
      messageId: id,
      prompt: id,
      source: { kind: "agent-message", agentId: "worker" },
    });
  withSessionOperationIdentity(
    { actor: { kind: "user", id: "alice", displayName: "Alice" }, channel, receivedAt },
    () => {
      enqueue("alice-one");
      enqueue("alice-two");
      currentSessionOperationIdentity()!.actor!.displayName = "Mutated after enqueue";
    },
  );
  withSessionOperationIdentity({ actor: { kind: "user", id: "bob" }, channel, receivedAt }, () =>
    enqueue("bob"),
  );
  withSessionOperationIdentity(
    { actor: { kind: "user", id: "bob" }, channel: { ...channel, channelId: "b" }, receivedAt },
    () => enqueue("bob-other-channel"),
  );
  enqueue("unknown");
  await withSessionOperationIdentity({ actor: { kind: "user", id: "shutdown-caller" } }, () =>
    delivery.close(),
  );
  expect(sent.map((batch) => batch.ids)).toEqual([
    ["alice-one", "alice-two"],
    ["bob"],
    ["bob-other-channel"],
    ["unknown"],
  ]);
  expect(sent[0]?.identity).toEqual({
    actor: { kind: "user", id: "alice", displayName: "Alice" },
    channel,
    receivedAt,
  });
  expect(sent[1]?.identity?.actor?.id).toBe("bob");
  expect(sent[2]?.identity?.channel?.channelId).toBe("b");
  expect(sent[3]?.identity).toBeUndefined();
});

test("a timer firing in the last sender context cannot relabel earlier queued messages", async () => {
  const clock = createClock();
  const actors: Array<string | undefined> = [];
  const delivery = createAgentMessageDelivery({
    schedule: clock.schedule,
    dispatch: async () => {
      actors.push(currentSessionOperationIdentity()?.actor?.id);
      return "steered";
    },
    onError: (error) => {
      throw error;
    },
  });
  for (const id of ["alice", "bob"])
    withSessionOperationIdentity({ actor: { kind: "user", id } }, () =>
      delivery.enqueue({
        recipientId: "parent",
        prompt: id,
        source: { kind: "agent-message", agentId: "worker" },
      }),
    );
  await withSessionOperationIdentity({ actor: { kind: "user", id: "ambient-bob" } }, async () => {
    clock.advance(2000);
    await delivery.close();
  });
  expect(actors).toEqual(["alice", "bob"]);
});
