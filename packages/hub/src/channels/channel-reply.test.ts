// The hub-side channel-reply MCP tool (E4/E6): the `message` tool a tool-path
// agent session dials on the Hub's own loopback at
// `POST /mcp/channel/<opaque-binding-ref>`. Tests the transport boundary the
// way execution-capabilities/server.test.ts does — direct `handle(request)`
// plus one official-client interop round trip — over a fake ledger + post
// seam, so no vertical, supervisor, or database is in the loop.

import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ChannelStore } from "../db/channels.js";
import { createFetchServer } from "../http/node-server.js";
import { createChannelReplyServer, type ChannelReplyPost } from "./channel-reply.js";
import { ChannelReplyCapabilityRegistry } from "./channel-reply-capabilities.js";
import {
  type ChannelReplyBindingRef,
  type OutboundPostParams,
  type OutboundPostResult,
} from "./plane/types.js";

const RpcResponseSchema = z
  .object({
    result: z.unknown().optional(),
    error: z.object({ code: z.number() }).passthrough().optional(),
  })
  .passthrough();
const ToolResultSchema = z.object({ isError: z.boolean().optional() }).passthrough();

const REF: ChannelReplyBindingRef = {
  channel: "slack",
  accountId: "work",
  externalConversationId: "C0WORK",
  externalThreadId: "1710000000.000001",
};
const TOKEN = "opaque-channel-reply-capability";

describe("ChannelReplyCapabilityRegistry", () => {
  it("rejects token forgery, cross-Agent rebinding, and cross-organization use", () => {
    const registry = new ChannelReplyCapabilityRegistry({ token: () => TOKEN });
    const token = registry.issue(capabilityInput());
    assert.equal(registry.bind(token, "agent-a"), true);
    assert.equal(registry.bind(token, "agent-b"), false);
    assert.equal(registry.resolve(`${token}-forged`, "org-1"), undefined);
    assert.equal(
      registry.resolve(
        Buffer.from(
          JSON.stringify({ ...REF, externalConversationId: "C_OTHER_ROUTE" }),
          "utf8",
        ).toString("base64url"),
        "org-1",
      ),
      undefined,
    );
    assert.equal(registry.resolve(token, "org-2"), undefined);
    const resolved = registry.resolve(token, "org-1");
    assert.equal(resolved?.agentId, "agent-a");
    if (resolved !== undefined) resolved.ref.externalConversationId = "C_OTHER_ROUTE";
    assert.equal(registry.resolve(token, "org-1")?.ref.externalConversationId, "C0WORK");
  });

  it("expires and revokes capabilities when their account is invalidated", () => {
    let now = 1_000;
    let sequence = 0;
    const registry = new ChannelReplyCapabilityRegistry({
      now: () => now,
      ttlMs: 100,
      token: () => `token-${++sequence}`,
    });
    const expired = registry.issue(capabilityInput());
    assert.equal(registry.bind(expired, "agent-expired"), true);
    now = 1_100;
    assert.equal(registry.resolve(expired, "org-1"), undefined);

    const revoked = registry.issue(capabilityInput());
    assert.equal(registry.bind(revoked, "agent-revoked"), true);
    registry.revokeAccount("org-1", "slack", "work");
    assert.equal(registry.resolve(revoked, "org-1"), undefined);
  });
});

describe("channel-reply MCP endpoint", () => {
  it("lists both reply tools", async () => {
    const fixture = makeFixture();
    const body = await fixture.call("tools/list");
    assert.equal(body.error, undefined);
    const tools = z
      .array(z.object({ name: z.string(), inputSchema: z.unknown() }))
      .parse((body.result as { tools: unknown[] }).tools);
    assert.deepEqual(
      tools.map(({ name }) => name),
      ["message", "send_file"],
    );
  });

  it("posts through the post seam and confirms the ledger row", async () => {
    const fixture = makeFixture();
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "done", final: true },
    });
    assert.equal(body.error, undefined);
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined);
    assert.deepEqual(fixture.posts, [
      {
        channel: "slack",
        accountId: "work",
        to: "C0WORK",
        threadId: "1710000000.000001",
        text: "done",
      },
    ]);
    // Record-before-post: the ledger row lands before the post, then confirms
    // with the native message id.
    assert.equal(fixture.records.length, 1);
    assert.equal(fixture.records[0]?.eventTurnId.startsWith("channel-reply:"), true);
    assert.deepEqual(fixture.confirms, [
      {
        eventTurnId: fixture.records[0]?.eventTurnId,
        externalMessageId: "1710000000.999999",
      },
    ]);
    assert.equal(fixture.failures.length, 0);
  });

  it("sends a local file and confirms its native id", async () => {
    const directory = await mkdtemp(join(tmpdir(), "channel-reply-file-"));
    const filePath = join(directory, "report.md");
    await writeFile(filePath, "report");
    const fixture = makeFixture({
      projectRoot: directory,
      mediaPost: async (ref, path) => {
        assert.equal(ref.accountId, "work");
        assert.equal(path, filePath);
        return { ok: true, externalMessageId: "file-1", mediaPosted: true };
      },
    });
    const body = await fixture.call("tools/call", {
      name: "send_file",
      arguments: { path: filePath },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined);
    assert.match(
      String((body.result as { content: [{ text: string }] }).content[0]?.text),
      /file-1/,
    );
    assert.deepEqual(fixture.confirms, [
      { eventTurnId: fixture.records[0]?.eventTurnId, externalMessageId: "file-1" },
    ]);
  });

  it("rejects a symlink inside the Project that points outside it (containment after realpath)", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "channel-reply-project-"));
    const outside = await mkdtemp(join(tmpdir(), "channel-reply-outside-"));
    const outsideFile = join(outside, "secret.md");
    await writeFile(outsideFile, "secret");
    const linkPath = join(projectRoot, "link.md");
    symlinkSync(outsideFile, linkPath);
    let mediaCalls = 0;
    const fixture = makeFixture({
      projectRoot,
      mediaPost: async () => {
        mediaCalls += 1;
        return { ok: true, externalMessageId: "x", mediaPosted: true };
      },
    });
    const body = await fixture.call("tools/call", {
      name: "send_file",
      arguments: { path: linkPath },
    });
    const result = ToolResultSchema.parse(body.result);
    assert.equal(result.isError, true);
    assert.match(
      String((body.result as { content: [{ text: string }] }).content[0]?.text),
      /outside the allowed Project root/,
    );
    assert.equal(mediaCalls, 0, "the vertical seam is never driven for an escaped path");
    assert.equal(fixture.records.length, 0, "no ledger row is recorded for a rejected path");
  });

  it("omits and rejects file sending when no Project root is configured", async () => {
    let mediaCalls = 0;
    const fixture = makeFixture({
      projectRoot: null,
      mediaPost: async () => {
        mediaCalls += 1;
        return { ok: true, externalMessageId: "x", mediaPosted: true };
      },
    });
    const listed = await fixture.call("tools/list");
    const tools = z
      .array(z.object({ name: z.string() }))
      .parse((listed.result as { tools: unknown[] }).tools);
    assert.deepEqual(
      tools.map(({ name }) => name),
      ["message"],
    );
    const body = await fixture.call("tools/call", {
      name: "send_file",
      arguments: { path: "/etc/hostname" },
    });
    const result = ToolResultSchema.parse(body.result);
    assert.equal(result.isError, true);
    assert.match(
      String((body.result as { content: [{ text: string }] }).content[0]?.text),
      /no Project root is configured/,
    );
    assert.equal(mediaCalls, 0, "absence of a home root is never unrestricted access");
    assert.equal(fixture.records.length, 0);
  });

  it("omits threadId when the ref is a conversation-root session", async () => {
    const rootRef: ChannelReplyBindingRef = { ...REF, externalThreadId: null };
    const fixture = makeFixture({ ref: rootRef });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "hello" },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined);
    assert.equal(fixture.posts[0]?.threadId, undefined);
    assert.equal(fixture.posts[0]?.text, "hello");
  });

  it("returns a clean tool error for an unknown or malformed binding ref", async () => {
    const fixture = makeFixture({ requestToken: "forged-token" });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "lost" },
    });
    assert.equal(body.error, undefined);
    const result = ToolResultSchema.parse(body.result);
    assert.equal(result.isError, true);
    assert.equal(fixture.posts.length, 0);
    assert.equal(fixture.records.length, 0);
  });

  it("returns a clean tool error for an unsupported action or empty text", async () => {
    const fixture = makeFixture();
    const badAction = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "edit", text: "x" },
    });
    assert.equal(ToolResultSchema.parse(badAction.result).isError, true);
    const emptyText = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "   " },
    });
    assert.equal(ToolResultSchema.parse(emptyText.result).isError, true);
    assert.equal(fixture.posts.length, 0);
  });

  it("fails the ledger row and returns a tool error when the post fails", async () => {
    const fixture = makeFixture({
      post: async () => ({ ok: false, error: "chat_not_found" }),
    });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "gone" },
    });
    const result = ToolResultSchema.parse(body.result);
    assert.equal(result.isError, true);
    assert.equal(fixture.posts.length, 0);
    assert.equal(fixture.failures.length, 1);
    assert.match(String(fixture.failures[0]?.failureReason), /chat_not_found/);
  });

  it("interoperates with the official MCP client", async () => {
    const fixture = makeFixture();
    const endpoint = await serve(fixture);
    const client = new Client({ name: "paseo-hub-channel-reply-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url));
    try {
      // The SDK's getter is typed `string | undefined` while its Transport
      // interface uses an exact-optional `sessionId?: string`; the runtime
      // class is the SDK's official transport.
      // @ts-expect-error upstream SDK exactOptionalPropertyTypes mismatch
      await client.connect(transport);
      assert.deepEqual(
        (await client.listTools()).tools.map((tool) => tool.name),
        ["message", "send_file"],
      );
      const result = await client.callTool({
        name: "message",
        arguments: { text: "via the official client", final: false },
      });
      assert.equal(result.isError, undefined);
      assert.equal(fixture.posts[0]?.text, "via the official client");
    } finally {
      await client.close();
      await closeServer(endpoint.server);
    }
  });
});

interface Fixture {
  server: ReturnType<typeof createChannelReplyServer>;
  posts: OutboundPostParams[];
  records: Array<{ eventTurnId: string; sequence: number }>;
  confirms: Array<{ eventTurnId: string; externalMessageId: string }>;
  failures: Array<{ eventTurnId: string; failureReason: string }>;
  call(method: string, params?: unknown): Promise<{ result: unknown; error?: { code: number } }>;
}

function makeFixture(
  options: {
    post?: ChannelReplyPost;
    mediaPost?: (
      ref: ChannelReplyBindingRef,
      path: string,
    ) => Promise<{
      ok: boolean;
      externalMessageId?: string;
      mediaPosted?: boolean;
      error?: string;
    }>;
    projectRoot?: string | null;
    ref?: ChannelReplyBindingRef;
    requestToken?: string;
  } = {},
): Fixture {
  const token = TOKEN;
  const registry = new ChannelReplyCapabilityRegistry({ token: () => token });
  const capabilityToken = registry.issue(
    capabilityInput({
      ref: options.ref ?? REF,
      projectRoot: options.projectRoot === undefined ? process.cwd() : options.projectRoot,
    }),
  );
  assert.equal(registry.bind(capabilityToken, "agent-1"), true);
  const requestToken = options.requestToken ?? capabilityToken;
  const posts: OutboundPostParams[] = [];
  const post: ChannelReplyPost =
    options.post ??
    (async (ref, text) => {
      posts.push({
        channel: ref.channel,
        accountId: ref.accountId,
        to: ref.externalConversationId,
        ...(ref.externalThreadId !== null ? { threadId: ref.externalThreadId } : {}),
        text,
      });
      return { ok: true, externalMessageId: "1710000000.999999" } satisfies OutboundPostResult;
    });
  const records: Array<{ eventTurnId: string; sequence: number }> = [];
  const confirms: Array<{ eventTurnId: string; externalMessageId: string }> = [];
  const failures: Array<{ eventTurnId: string; failureReason: string }> = [];
  const store = {
    recordDelivery: async (input: {
      eventTurnId: string;
      sequence: number;
    }): Promise<{ created: boolean }> => {
      records.push({ eventTurnId: input.eventTurnId, sequence: input.sequence });
      return { created: true };
    },
    confirmDelivery: async (input: {
      eventTurnId: string;
      externalMessageId: string;
    }): Promise<unknown> => {
      confirms.push({ eventTurnId: input.eventTurnId, externalMessageId: input.externalMessageId });
      return {};
    },
    failDelivery: async (input: {
      eventTurnId: string;
      failureReason: string;
    }): Promise<unknown> => {
      failures.push({ eventTurnId: input.eventTurnId, failureReason: input.failureReason });
      return {};
    },
  } as unknown as ChannelStore;
  const server = createChannelReplyServer({
    organizationId: "org-1",
    store,
    resolveCapability: (candidate) => registry.resolve(candidate, "org-1"),
    post,
    ...(options.mediaPost === undefined ? {} : { mediaPost: options.mediaPost }),
  });
  let id = 0;
  return {
    server,
    posts,
    records,
    confirms,
    failures,
    async call(method, params = undefined) {
      id += 1;
      const response = await server.handle(
        new Request(`https://hub.test/mcp/channel/${requestToken}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
        }),
        requestToken,
      );
      return RpcResponseSchema.parse(await response.json()) as {
        result: unknown;
        error?: { code: number };
      };
    },
  };
}

function capabilityInput(
  options: {
    ref?: ChannelReplyBindingRef;
    projectRoot?: string | null;
  } = {},
) {
  return {
    organizationId: "org-1",
    channelRevisionId: "revision-1",
    routePosition: 0,
    routeFingerprint: "route-a",
    ref: options.ref ?? REF,
    ...(options.projectRoot === null || options.projectRoot === undefined
      ? {}
      : { projectRoot: options.projectRoot }),
  };
}

async function serve(fixture: Fixture) {
  const server = createFetchServer((request) =>
    fixture.server.handle(request, new URL(request.url).pathname.split("/")[3] ?? ""),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("channel-reply fixture did not bind a TCP port");
  }
  return { server, url: `http://127.0.0.1:${address.port}/mcp/channel/${TOKEN}` };
}

async function closeServer(server: import("node:http").Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
