// D-W4-01: an Agent outlives the Hub process. The daemon keeps the
// `channel_reply` MCP URL it was created with, so the capability behind that
// URL has to survive a restart — before this, a restarted Hub answered
// `tools/list` with an empty list and `tools/call` with "unknown, expired, or
// revoked", silently, for the rest of that Agent's life.
//
// The restart is simulated the only way that proves durability: a SECOND
// registry instance, built over the same migrated database, with nothing
// carried over in memory.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { z } from "zod";
import { ChannelReplyCapabilityStore } from "../db/channel-reply-capabilities.js";
import { embeddedDatabaseRuntime } from "../db/runtime/index.js";
import type { DatabaseRuntimeBundle } from "../db/runtime/index.js";
import type { ChannelStore } from "../db/channels.js";
import { ChannelReplyCapabilityRegistry } from "./channel-reply-capabilities.js";
import { createChannelReplyServer } from "./channel-reply.js";
import type { ChannelReplyBindingRef, OutboundPostParams } from "./plane/types.js";

const ORGANIZATION_ID = "capability-org";
/** The native id of the sender the thread was opened by (Telegram user id). */
const REQUESTER_SENDER_ID = "77123";
const REF: ChannelReplyBindingRef = {
  channel: "telegram",
  accountId: "personal",
  externalConversationId: "-1001234567890",
  externalThreadId: "2",
};

const RpcResponseSchema = z
  .object({
    result: z.unknown().optional(),
    error: z.object({ code: z.number() }).passthrough().optional(),
  })
  .passthrough();

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelReplyCapabilityStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-channel-capability-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Capability Org', 'capability-org')`,
    [ORGANIZATION_ID],
  );
  store = new ChannelReplyCapabilityStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("channel reply capabilities across a Hub restart", () => {
  it("answers tools/list and tools/call on a capability minted by the previous process", async () => {
    const minted = new ChannelReplyCapabilityRegistry({ store });
    const token = minted.issue(capabilityInput());
    assert.equal(minted.bind(token, "agent-restart"), true);
    await minted.flush();

    // The restart: nothing but the database crosses this line.
    const restored = new ChannelReplyCapabilityRegistry({ store });
    await restored.hydrate();
    const capability = restored.resolve(token, ORGANIZATION_ID);
    assert.equal(capability?.agentId, "agent-restart");
    assert.deepEqual(capability?.ref, REF);
    assert.equal(capability?.routePosition, 0);
    assert.equal(capability?.routeFingerprint, "route-a");
    assert.equal(capability?.projectRoot, process.cwd());
    assert.equal(capability?.outputBudget?.executionId, "execution-1");

    const posts: OutboundPostParams[] = [];
    const server = createChannelReplyServer({
      organizationId: ORGANIZATION_ID,
      store: fakeDeliveryStore(),
      outputStore: fakeOutputStore(),
      resolveCapability: (candidate) => restored.resolve(candidate, ORGANIZATION_ID),
      post: async (ref, text) => {
        posts.push({
          channel: ref.channel,
          accountId: ref.accountId,
          to: ref.externalConversationId,
          ...(ref.externalThreadId !== null ? { threadId: ref.externalThreadId } : {}),
          text,
        });
        return { ok: true, externalMessageId: "restored-1" };
      },
    });

    const listed = await call(server, token, "tools/list");
    const tools = z
      .array(z.object({ name: z.string() }))
      .parse((listed.result as { tools: unknown[] }).tools);
    assert.ok(tools.some((tool) => tool.name === "message"));

    const called = await call(server, token, "tools/call", {
      name: "message",
      arguments: { action: "send", message: "PONG-after-restart" },
    });
    assert.equal(called.error, undefined);
    assert.equal((called.result as { isError?: boolean }).isError, undefined);
    assert.deepEqual(posts, [
      {
        channel: "telegram",
        accountId: "personal",
        to: "-1001234567890",
        threadId: "2",
        text: "PONG-after-restart",
      },
    ]);
  });

  it("answers tools/list in the window before the Agent is bound", async () => {
    // The daemon starts the Agent and the Agent dials the MCP URL before
    // `createAgent` returns, so the capability is still pending on its first
    // `tools/list`. Refusing that window handed the Agent an empty tool list
    // for its whole session (live 2026-09-07, agent b33fd0d6).
    const pending = new ChannelReplyCapabilityRegistry({ store });
    const token = pending.issue(capabilityInput());
    const server = createChannelReplyServer({
      organizationId: ORGANIZATION_ID,
      store: fakeDeliveryStore(),
      outputStore: fakeOutputStore(),
      resolveCapability: (candidate) => pending.resolve(candidate, ORGANIZATION_ID),
      post: async () => ({ ok: true, externalMessageId: "pending-1" }),
    });
    const listed = await call(server, token, "tools/list");
    const tools = z
      .array(z.object({ name: z.string() }))
      .parse((listed.result as { tools: unknown[] }).tools);
    assert.ok(tools.some((tool) => tool.name === "message"));
    assert.equal(pending.resolve(token, ORGANIZATION_ID)?.agentId, null);
    assert.equal(pending.bind(token, "agent-late"), true);
    assert.equal(pending.resolve(token, ORGANIZATION_ID)?.agentId, "agent-late");
    await pending.flush();
  });

  it("logs the unknown capability a restart cannot answer", async () => {
    const warnings: Array<{ message: string; detail?: Record<string, unknown> }> = [];
    const server = createChannelReplyServer({
      organizationId: ORGANIZATION_ID,
      store: fakeDeliveryStore(),
      resolveCapability: () => undefined,
      post: async () => ({ ok: true, externalMessageId: "unused" }),
      log: { warn: (message, detail) => warnings.push({ message, ...(detail ? { detail } : {}) }) },
    });
    const listed = await call(server, "dead-token", "tools/list");
    assert.deepEqual((listed.result as { tools: unknown[] }).tools, []);
    const called = await call(server, "dead-token", "tools/call", {
      name: "message",
      arguments: { action: "send", message: "into the void" },
    });
    assert.equal((called.result as { isError?: boolean }).isError, true);
    assert.deepEqual(
      warnings.map((entry) => [entry.message, entry.detail?.["verb"]]),
      [
        ["channel reply capability unknown", "tools/list"],
        ["channel reply capability unknown", "tools/call"],
      ],
    );
  });

  it("keeps the requester of a capability minted by the previous process", async () => {
    // Without the durable requester the restored capability fails closed on
    // both consumers: the executors' channel-local trust check and the command
    // buttons minted for that one actor.
    const minted = new ChannelReplyCapabilityRegistry({ store });
    const token = minted.issue(capabilityInput());
    assert.equal(minted.bind(token, "agent-requester"), true);
    await minted.flush();

    const restored = new ChannelReplyCapabilityRegistry({ store });
    await restored.hydrate();
    assert.equal(restored.resolve(token, ORGANIZATION_ID)?.requesterSenderId, REQUESTER_SENDER_ID);
  });

  it("keeps a revoked account out of the restored set", async () => {
    const minted = new ChannelReplyCapabilityRegistry({ store });
    const token = minted.issue(capabilityInput());
    assert.equal(minted.bind(token, "agent-revoked"), true);
    minted.revokeAccount(ORGANIZATION_ID, REF.channel, REF.accountId);
    await minted.flush();

    const restored = new ChannelReplyCapabilityRegistry({ store });
    await restored.hydrate();
    assert.equal(restored.resolve(token, ORGANIZATION_ID), undefined);
  });

  it("drops expired rows instead of restoring them", async () => {
    let now = 1_000;
    const minted = new ChannelReplyCapabilityRegistry({ store, ttlMs: 100, now: () => now });
    const token = minted.issue(capabilityInput());
    assert.equal(minted.bind(token, "agent-expired"), true);
    await minted.flush();
    now = 2_000;

    const restored = new ChannelReplyCapabilityRegistry({ store, now: () => now });
    await restored.hydrate();
    assert.equal(restored.resolve(token, ORGANIZATION_ID), undefined);
    const rows = await store.listActive(new Date(0));
    assert.equal(
      rows.some((row) => row.agentId === "agent-expired"),
      false,
    );
  });

  // A conversation that stays busy for longer than the TTL used to lose its
  // reply tool mid-session: the capability was minted once and never renewed,
  // so the Agent's next `tools/call` answered "unknown, expired, or revoked".
  it("slides the expiry on use and persists the slide for the next process", async () => {
    let now = 10_000;
    const ttlMs = 1_000;
    const minted = new ChannelReplyCapabilityRegistry({ store, ttlMs, now: () => now });
    const token = minted.issue(capabilityInput());
    assert.equal(minted.bind(token, "agent-sliding"), true);
    // Used just before the original expiry, and again a full TTL later.
    now = 10_900;
    assert.ok(minted.resolve(token, ORGANIZATION_ID));
    now = 11_800;
    assert.ok(minted.resolve(token, ORGANIZATION_ID), "the slide kept the capability alive");
    await minted.flush();

    const restored = new ChannelReplyCapabilityRegistry({ store, ttlMs, now: () => now });
    await restored.hydrate();
    assert.ok(
      restored.resolve(token, ORGANIZATION_ID),
      "the durable row carries the slid expiry, not the minting one",
    );
  });
});

function capabilityInput() {
  return {
    organizationId: ORGANIZATION_ID,
    channelRevisionId: "0712b046-e77d-4d2d-8154-cb861e4a80ac",
    routePosition: 0 as const,
    routeFingerprint: "route-a",
    ref: REF,
    projectRoot: process.cwd(),
    requesterSenderId: REQUESTER_SENDER_ID,
    outputBudget: { executionId: "execution-1", type: "telegram.reply", max: 8 },
  };
}

/** The delivery ledger the `message` tool records through; not under test here. */
function fakeDeliveryStore(): ChannelStore {
  return {
    recordDelivery: async () => ({ created: true }),
    confirmDelivery: async () => ({}),
    failDelivery: async () => ({}),
  } as unknown as ChannelStore;
}

/** The execution-output budget ledger; the restored budget is what it proves. */
function fakeOutputStore(): NonNullable<
  Parameters<typeof createChannelReplyServer>[0]["outputStore"]
> {
  return {
    beginAgentExecutionOutput: async () => ({ id: "attempt-1" }),
    completeAgentExecutionOutput: async () => undefined,
    failAgentExecutionOutput: async () => undefined,
  } as unknown as NonNullable<Parameters<typeof createChannelReplyServer>[0]["outputStore"]>;
}

async function call(
  server: { handle(request: Request, token: string): Promise<Response> },
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ result: unknown; error?: { code: number } }> {
  const response = await server.handle(
    new Request(`https://hub.test/mcp/channel/${token}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
    }),
    token,
  );
  return RpcResponseSchema.parse(await response.json()) as {
    result: unknown;
    error?: { code: number };
  };
}
