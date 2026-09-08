// The hub-side channel-reply MCP tool (E4/E6): the `message` tool a tool-path
// agent session dials on the Hub's own loopback at
// `POST /mcp/channel/<opaque-binding-ref>`. Tests the transport boundary the
// way execution-capabilities/server.test.ts does — direct `handle(request)`
// plus one official-client interop round trip — over a fake ledger + post
// seam, so no vertical, supervisor, or database is in the loop.

import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, it } from "vitest";
import { mkdtemp, truncate, writeFile } from "node:fs/promises";
import { symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { SLACK_MAX_MEDIA_BYTES } from "@getpaseo/channels-shared";
import { createMemoryDatabase } from "../db/memory.js";
import type { ChannelReplyMcp } from "./channel-reply.js";
import type { ChannelReplyOutputBudget } from "./channel-reply-capabilities.js";
import type { ChannelStore } from "../db/channels.js";
import { createFetchServer } from "../http/node-server.js";
import {
  createChannelReplyServer,
  type ChannelReplyMediaPost,
  type ChannelReplyPost,
} from "./channel-reply.js";
import { ChannelReplyCapabilityRegistry } from "./channel-reply-capabilities.js";
import {
  buildChannelMessageToolSchema,
  forgetChannelMessageToolCatalog,
  HOST_ONLY_MESSAGE_TOOL_FIELDS,
  listChannelMessageToolActions,
} from "./channel-message-tool.js";
import { clearChannelMessageActions, registerChannelMessageActions } from "./message-actions.js";
import { redeemChannelCommandButton } from "./command-buttons.js";
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

/** The tool result's text, used as an assertion message so a failing media case
 * names the refusal instead of reporting `true !== undefined`. */
function resultText(body: { result?: unknown }): string {
  const content = (body.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  return content?.map((entry) => entry.text ?? "").join("\n") ?? "";
}

const REF: ChannelReplyBindingRef = {
  channel: "slack",
  accountId: "work",
  externalConversationId: "C0WORK",
  externalThreadId: "1710000000.000001",
};
/** The organization-scoped account every registry in this file is keyed by. */
const SLACK_WORK = { organizationId: "org-1", channel: "slack", accountId: "work" };
const REQUESTER_SENDER_ID = "U0REQUESTER";
const TOKEN = "opaque-channel-reply-capability";
/** A 1x1 PNG: real header bytes, so MIME sniffing is exercised, not stubbed. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
      ["message"],
    );
    const message = tools.find((tool) => tool.name === "message") as {
      inputSchema: { properties?: Record<string, unknown> };
    };
    assert.ok(message.inputSchema.properties?.["message"]);
    assert.ok(message.inputSchema.properties?.["text"]);
    assert.ok(message.inputSchema.properties?.["idempotencyKey"]);
  });

  it("generates the message schema from the account's channel capabilities", () => {
    const telegram = buildChannelMessageToolSchema("telegram");
    const slack = buildChannelMessageToolSchema("slack");
    const actionEnum = (schema: { properties: Record<string, unknown> }) =>
      (schema.properties["action"] as { enum: string[] }).enum;

    // The action enum is the channel's own advertised set, not a fixed list.
    assert.ok(actionEnum(telegram).includes("poll"));
    assert.ok(!actionEnum(telegram).includes("list-pins"));
    assert.ok(actionEnum(slack).includes("list-pins"));
    assert.ok(!actionEnum(slack).includes("poll"));

    // Property groups follow the actions. Telegram's poll and topic actions pull
    // in the poll and channel-management groups; Slack advertises neither, so its
    // schema is 19 keys smaller. Both reach the fetch group (Slack through read,
    // Telegram through sticker-search) and both keep the send group.
    assert.ok(telegram.properties["pollQuestion"]);
    assert.ok(telegram.properties["topic"]);
    assert.equal(slack.properties["pollQuestion"], undefined);
    assert.equal(slack.properties["topic"], undefined);
    assert.ok(slack.properties["pageToken"]);
    assert.ok(telegram.properties["pageToken"]);
    assert.ok(Object.keys(slack.properties).length < Object.keys(telegram.properties).length);
    for (const schema of [telegram, slack]) {
      assert.ok(schema.properties["message"]);
      assert.ok(schema.properties["presentation"]);
      assert.ok(schema.properties["attachments"]);
      // Fusion's own contracts survive schema generation.
      assert.ok(schema.properties["text"]);
      assert.ok(schema.properties["idempotencyKey"]);
      assert.ok(schema.properties["final"]);
      assert.deepEqual(schema.required, ["action"]);
    }
  });

  it("excludes host and cross-destination fields from the generated schema", () => {
    for (const channel of ["slack", "telegram"] as const) {
      const schema = buildChannelMessageToolSchema(channel);
      for (const field of HOST_ONLY_MESSAGE_TOOL_FIELDS) {
        assert.equal(schema.properties[field], undefined, `${channel} must not expose ${field}`);
      }
    }
  });

  it("returns a structured unsupported_action result for an advertised but unexecutable action", async () => {
    const fixture = makeFixture();
    assert.ok(listChannelMessageToolActions("slack").includes("pin"));
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "pin", messageId: "1710000000.000001" },
    });
    const result = z
      .object({
        isError: z.boolean().optional(),
        structuredContent: z
          .object({ status: z.string(), action: z.string(), reason: z.string() })
          .optional(),
      })
      .passthrough()
      .parse(body.result);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.status, "unsupported_action");
    assert.equal(result.structuredContent?.action, "pin");
    assert.match(result.structuredContent?.reason ?? "", /does not execute it yet/);
    // Nothing reached the outbound seam or the ledger.
    assert.equal(fixture.posts.length, 0);
    assert.equal(fixture.records.length, 0);
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

  it("accepts OpenClaw's canonical message field and returns structured delivery metadata", async () => {
    const fixture = makeFixture();
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "send", message: "canonical", idempotencyKey: "turn-42" },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined);
    assert.equal(fixture.posts[0]?.text, "canonical");
    assert.equal(fixture.records[0]?.eventTurnId, "channel-reply:agent-1:turn-42");
    assert.deepEqual((body.result as { structuredContent: unknown }).structuredContent, {
      ok: true,
      action: "send",
      channel: "slack",
      accountId: "work",
      to: "C0WORK",
      threadId: "1710000000.000001",
      messageId: "1710000000.999999",
      deliveryId: "channel-reply:agent-1:turn-42",
      final: true,
    });
  });

  it("rejects conflicting text and message aliases before reserving delivery", async () => {
    const fixture = makeFixture();
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "one", message: "two" },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, true);
    assert.equal(fixture.records.length, 0);
    assert.equal(fixture.posts.length, 0);
  });

  it("sends a local file and confirms its native id", async () => {
    const directory = await mkdtemp(join(tmpdir(), "channel-reply-file-"));
    const filePath = join(directory, "report.md");
    await writeFile(filePath, "report");
    const fixture = makeFixture({
      projectRoot: directory,
      mediaPost: async (ref, file) => {
        assert.equal(ref.accountId, "work");
        assert.equal(file.filePath, filePath);
        assert.equal(file.fileName, "report.md");
        return { ok: true, externalMessageId: "file-1", mediaPosted: true };
      },
    });
    const listed = await fixture.call("tools/list");
    const tools = z
      .array(z.object({ name: z.string(), description: z.string() }))
      .parse((listed.result as { tools: unknown[] }).tools);
    assert.deepEqual(
      tools.map(({ name }) => name),
      ["message"],
      "there is no separate file tool: files ride `message`",
    );
    assert.match(
      tools.find((tool) => tool.name === "message")?.description ?? "",
      /Send files with this tool too/,
    );
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "send", attachments: [{ media: filePath }] },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined);
    assert.equal(
      (body.result as { structuredContent: { messageId: string } }).structuredContent.messageId,
      "file-1",
    );
    assert.equal(fixture.posts.length, 0, "a caption-less file posts no separate text message");
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
      name: "message",
      arguments: { action: "send", attachments: [{ media: linkPath }] },
    });
    const result = ToolResultSchema.parse(body.result);
    assert.equal(result.isError, true);
    assert.match(
      String((body.result as { content: [{ text: string }] }).content[0]?.text),
      /outside the allowed Project root/,
    );
    assert.equal(mediaCalls, 0, "the vertical seam is never driven for an escaped path");
    // Record-before-post applies to a refused file too: the anchor row is
    // claimed, then failed, so a retry re-arms the same key instead of finding
    // an unexplained gap.
    assert.deepEqual(
      fixture.records.map((record) => record.sequence),
      [0],
    );
    assert.equal(fixture.confirms.length, 0);
    assert.match(String(fixture.failures[0]?.failureReason), /outside the allowed Project root/);
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
      name: "message",
      arguments: { action: "send", attachments: [{ media: "/etc/hostname" }] },
    });
    const result = ToolResultSchema.parse(body.result);
    assert.equal(result.isError, true);
    assert.match(
      String((body.result as { content: [{ text: string }] }).content[0]?.text),
      /no Project root is configured/,
    );
    assert.equal(mediaCalls, 0, "absence of a home root is never unrestricted access");
    assert.equal(fixture.confirms.length, 0);
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

  it("sends text and two attachments as one send, one ledger row per message", async () => {
    const directory = await mkdtemp(join(tmpdir(), "channel-reply-media-"));
    const note = join(directory, "notes.txt");
    const png = join(directory, "chart.png");
    await writeFile(note, "notes");
    await writeFile(png, PNG_BYTES);
    const posted: Array<{ fileName: string; mimeType?: string }> = [];
    const fixture = makeFixture({
      projectRoot: directory,
      mediaPost: async (_ref, file) => {
        posted.push({
          fileName: file.fileName,
          ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        });
        return { ok: true, externalMessageId: `file-${posted.length}`, mediaPosted: true };
      },
    });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: {
        action: "send",
        message: "here are the files",
        attachments: [{ media: note }, { media: png }],
      },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined, resultText(body));
    assert.deepEqual(posted, [
      { fileName: "notes.txt", mimeType: "text/plain" },
      { fileName: "chart.png", mimeType: "image/png" },
    ]);
    assert.deepEqual(
      fixture.posts.map((post) => post.text),
      ["here are the files"],
    );
    // One row per platform message under one delivery key.
    assert.deepEqual(
      fixture.records.map((record) => record.sequence),
      [0, 1, 2],
    );
    assert.deepEqual(
      fixture.confirms.map((confirm) => confirm.externalMessageId),
      ["1710000000.999999", "file-1", "file-2"],
    );
    const structured = (body.result as { structuredContent: { deliveries: unknown[] } })
      .structuredContent;
    assert.deepEqual(structured.deliveries, [
      { ok: true, messageId: "1710000000.999999" },
      { ok: true, messageId: "file-1", mediaPosted: true },
      { ok: true, messageId: "file-2", mediaPosted: true },
    ]);
  });

  it("stages inline base64 buffer bytes and posts them as a file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "channel-reply-buffer-"));
    let staged: { fileName: string; mimeType?: string; bytes: number } | undefined;
    const fixture = makeFixture({
      projectRoot: directory,
      mediaPost: async (_ref, file) => {
        const { readFile } = await import("node:fs/promises");
        staged = {
          fileName: file.fileName,
          ...(file.mimeType ? { mimeType: file.mimeType } : {}),
          bytes: (await readFile(file.filePath)).byteLength,
        };
        return { ok: true, externalMessageId: "buffer-1", mediaPosted: true };
      },
    });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "send", buffer: PNG_BYTES.toString("base64"), filename: "inline.png" },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined, resultText(body));
    assert.deepEqual(staged, {
      fileName: "inline.png",
      mimeType: "image/png",
      bytes: PNG_BYTES.byteLength,
    });
    assert.equal(fixture.posts.length, 0, "a file-only send posts no empty text message");
  });

  it("refuses an oversize file before anything reaches the channel", async () => {
    const directory = await mkdtemp(join(tmpdir(), "channel-reply-oversize-"));
    const huge = join(directory, "huge.bin");
    await writeFile(huge, "x");
    // Slack's cap is 250 MB; report the file as larger without writing it.
    await truncate(huge, SLACK_MAX_MEDIA_BYTES + 1);
    let mediaCalls = 0;
    const fixture = makeFixture({
      projectRoot: directory,
      mediaPost: async () => {
        mediaCalls += 1;
        return { ok: true, externalMessageId: "never", mediaPosted: true };
      },
    });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "send", media: huge },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, true);
    assert.match(
      String((body.result as { content: [{ text: string }] }).content[0]?.text),
      /too large \(Slack limit 250 MB\)/,
    );
    assert.equal(mediaCalls, 0);
    assert.equal(fixture.confirms.length, 0);
  });

  it("refuses a remote media URL that resolves to a private address", async () => {
    const directory = await mkdtemp(join(tmpdir(), "channel-reply-ssrf-"));
    let mediaCalls = 0;
    const fixture = makeFixture({
      projectRoot: directory,
      mediaPost: async () => {
        mediaCalls += 1;
        return { ok: true, externalMessageId: "never", mediaPosted: true };
      },
    });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "send", media: "http://169.254.169.254/latest/meta-data/iam" },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, true);
    assert.match(
      String((body.result as { content: [{ text: string }] }).content[0]?.text),
      /remote media host is not allowed/,
    );
    assert.equal(mediaCalls, 0, "no fetch and no post for a blocked host");
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
        ["message"],
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
  registry: ChannelReplyCapabilityRegistry;
  posts: OutboundPostParams[];
  records: Array<{ eventTurnId: string; sequence: number }>;
  confirms: Array<{ eventTurnId: string; externalMessageId: string }>;
  failures: Array<{ eventTurnId: string; failureReason: string }>;
  call(method: string, params?: unknown): Promise<{ result: unknown; error?: { code: number } }>;
}

// The vertical's ported `ChannelMessageActionAdapter` is the only thing that
// makes a non-send action executable. These drive the production path:
// `message` -> the action gate -> `runMessageAction` (normalization, routing,
// target/thread resolution) -> `dispatchChannelMessageAction` -> `handleAction`.
describe("channel message actions", () => {
  interface Captured {
    channel: string;
    action: string;
    accountId?: string | null;
    params: Record<string, unknown>;
  }

  function installAdapter(
    options: {
      actions?: readonly string[];
      supports?: (action: string) => boolean;
      handle?: (ctx: Captured) => Promise<unknown>;
    } = {},
  ): Captured[] {
    const seen: Captured[] = [];
    const actions = options.actions ?? ["send", "react", "edit", "delete"];
    registerChannelMessageActions(SLACK_WORK, {
      messageActions: {
        describeMessageTool: () => ({ actions, capabilities: ["presentation"] }),
        ...(options.supports === undefined
          ? {}
          : { supportsAction: ({ action }: { action: string }) => options.supports!(action) }),
        handleAction: async (ctx: Captured) => {
          seen.push({
            channel: ctx.channel,
            action: ctx.action,
            accountId: ctx.accountId ?? null,
            params: { ...ctx.params },
          });
          const details = (await options.handle?.(ctx)) ?? {
            ok: true,
            messageId: "1710000000.777",
          };
          return { content: [{ type: "text", text: `did ${ctx.action}` }], details };
        },
      },
    });
    forgetChannelMessageToolCatalog(SLACK_WORK);
    return seen;
  }

  afterEach(() => {
    clearChannelMessageActions(SLACK_WORK);
    forgetChannelMessageToolCatalog(SLACK_WORK);
  });

  it("dispatches react/edit/delete to the vertical adapter on the bound conversation", async () => {
    const seen = installAdapter();
    const fixture = makeFixture();
    for (const [action, extra] of [
      ["react", { messageId: "1710000000.000042", emoji: "eyes" }],
      ["edit", { messageId: "1710000000.000042", message: "corrected" }],
      ["delete", { messageId: "1710000000.000042" }],
    ] as const) {
      const body = await fixture.call("tools/call", {
        name: "message",
        arguments: { action, ...extra },
      });
      assert.equal(body.error, undefined);
      const result = z
        .object({
          isError: z.boolean().optional(),
          structuredContent: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough()
        .parse(body.result);
      assert.equal(result.isError, undefined, `${action} must succeed`);
      assert.equal(result.structuredContent?.["ok"], true);
      assert.equal(result.structuredContent?.["action"], action);
      assert.equal(result.structuredContent?.["handledBy"], "plugin");
      assert.equal(result.structuredContent?.["messageId"], "1710000000.777");
    }
    assert.deepEqual(
      seen.map((entry) => entry.action),
      ["react", "edit", "delete"],
    );
    // Every dispatch is addressed by the capability's binding, never by the model.
    for (const entry of seen) {
      assert.equal(entry.channel, "slack");
      assert.equal(entry.accountId, "work");
      assert.equal(entry.params["target"], "C0WORK");
      assert.equal(entry.params["to"], "C0WORK");
      assert.equal(entry.params["threadId"], "1710000000.000001");
      assert.equal(entry.params["messageId"], "1710000000.000042");
    }
    assert.equal(seen[0]?.params["emoji"], "eyes");
    assert.equal(seen[1]?.params["message"], "corrected");
    // A non-send action posts no new message, so the delivery ledger stays clean.
    assert.equal(fixture.posts.length, 0);
    assert.equal(fixture.records.length, 0);
  });

  it("advertises the adapter's action set and executes only what it handles", async () => {
    installAdapter({ actions: ["send", "react", "pin"], supports: (action) => action !== "pin" });
    const fixture = makeFixture();
    const schema = buildChannelMessageToolSchema("slack", SLACK_WORK);
    const actionEnum = (schema.properties["action"] as { enum: string[] }).enum;
    assert.deepEqual(actionEnum.toSorted(), ["pin", "react", "send"]);

    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "pin", messageId: "1710000000.000042" },
    });
    const result = z
      .object({
        isError: z.boolean().optional(),
        structuredContent: z.object({ status: z.string(), reason: z.string() }).optional(),
      })
      .passthrough()
      .parse(body.result);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.status, "unsupported_action");
    assert.match(result.structuredContent?.reason ?? "", /does not execute it yet/);
  });

  it("normalizes snake_case params and reports a failed action without inventing a delivery", async () => {
    const seen = installAdapter({
      handle: async () => ({ ok: false, error: "message_not_found" }),
    });
    const fixture = makeFixture();
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "react", message_id: "1710000000.000042", emoji: "x" },
    });
    const result = z
      .object({
        isError: z.boolean().optional(),
        structuredContent: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .parse(body.result);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent?.["ok"], false);
    assert.equal(result.structuredContent?.["error"], "message_not_found");
    // The snake_case alias reaches the adapter untouched; core reads both spellings.
    assert.equal(seen[0]?.params["message_id"], "1710000000.000042");
    assert.equal(fixture.records.length, 0);
  });

  it("refuses a call that carries a host-only field, before the ledger", async () => {
    installAdapter();
    // `dryRun` is the sharp one: core's runner reads it off the params, so an
    // accepted `dryRun: true` would record a delivery, answer "posted" and post
    // nothing. `target` would aim the reply at another conversation.
    for (const args of [
      { action: "send", message: "no post, please", dryRun: true },
      { action: "send", message: "somewhere else", target: "C0OTHER" },
      { action: "react", messageId: "1710000000.000042", emoji: "eyes", channel: "telegram" },
    ]) {
      const fixture = makeFixture();
      const body = await fixture.call("tools/call", { name: "message", arguments: args });
      const result = z
        .object({
          isError: z.boolean().optional(),
          structuredContent: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough()
        .parse(body.result);
      assert.equal(result.isError, true, JSON.stringify(args));
      assert.equal(result.structuredContent?.["status"], "host_only_field");
      assert.equal(fixture.posts.length, 0);
      assert.equal(fixture.records.length, 0);
    }
  });

  it("keeps a channel credential out of a failed action's tool result", async () => {
    // The vertical's HTTP client quotes the request it failed on, token and all.
    const secret = "xoxb-unit-test-credential";
    installAdapter({
      handle: async () => {
        throw new Error(`Slack API error: invalid_auth (bot token ${secret})`);
      },
    });
    const fixture = makeFixture();
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "react", messageId: "1710000000.000042", emoji: "eyes" },
    });
    const serialized = JSON.stringify(body.result);
    assert.equal(ToolResultSchema.parse(body.result).isError, true);
    assert.ok(!serialized.includes(secret), serialized);
    assert.match(serialized, /invalid_auth/u);
    assert.match(serialized, /redacted/u);
  });

  // Command buttons are Hub-issued (`command-buttons.ts`). The model writes
  // `/new`; what leaves the Hub is an opaque one-shot token bound to this
  // capability's conversation and requester.
  it("mints every command button in a send before it can reach the platform", async () => {
    installAdapter();
    const fixture = makeFixture();
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: {
        action: "send",
        message: "pick one",
        presentation: {
          blocks: [
            {
              type: "buttons",
              buttons: [
                { label: "Start over", action: { type: "command", command: "/new" } },
                { label: "Docs", action: { type: "url", url: "https://paseo.sh" } },
              ],
            },
          ],
        },
      },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined, resultText(body));
    const posted = fixture.posts[0]?.text ?? "";
    assert.ok(!posted.includes("/new"), posted);
    const token = /\/cb-[0-9a-f]+/u.exec(posted)?.[0];
    assert.ok(token, posted);
    // The url button is untouched: only a command carries authority.
    assert.match(posted, /https:\/\/paseo\.sh/u);

    const click = {
      organizationId: "org-1",
      channel: "slack",
      accountId: "work",
      conversationId: REF.externalConversationId,
    };
    // Anyone else in the conversation is refused; the turn's requester is not.
    assert.deepEqual(redeemChannelCommandButton(token, { ...click, actorId: "U0STRANGER" }), {
      ok: false,
      reason: "foreign-actor",
    });
    const redeemed = redeemChannelCommandButton(token, {
      ...click,
      actorId: REQUESTER_SENDER_ID,
    });
    assert.equal(redeemed.ok, true);
    assert.equal(redeemed.ok ? redeemed.command : "", "/new");
  });

  it("keeps send on the outbound seam and the delivery ledger", async () => {
    installAdapter();
    const fixture = makeFixture();
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "send", message: "through the seam" },
    });
    assert.equal(body.error, undefined);
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined);
    assert.deepEqual(fixture.posts, [
      {
        channel: "slack",
        accountId: "work",
        to: "C0WORK",
        threadId: "1710000000.000001",
        text: "through the seam",
      },
    ]);
    assert.equal(fixture.records.length, 1);
    assert.equal(fixture.confirms.length, 1);
  });
});

// The delivery ledger's key for a `send`. `idempotencyKey` is model-supplied and
// only means anything inside the turn that produced it, so the key is namespaced
// by the capability's execution; a prior row decides whether the call replays,
// posts again, or refuses.
describe("channel-reply send idempotency", () => {
  it("scopes the idempotency key to the execution, so the next turn posts again", async () => {
    const first = await outputBudgetFixture();
    const second = await outputBudgetFixture();
    const turnOne = makeFixture({ outputBudget: first.outputBudget, outputStore: first.database });
    const turnTwo = makeFixture({
      outputBudget: second.outputBudget,
      outputStore: second.database,
    });
    for (const fixture of [turnOne, turnTwo]) {
      const body = await fixture.call("tools/call", {
        name: "message",
        arguments: { message: "same key, different turn", idempotencyKey: "reply-1" },
      });
      assert.equal(ToolResultSchema.parse(body.result).isError, undefined);
    }
    assert.equal(
      turnOne.records[0]?.eventTurnId,
      `channel-reply:${first.outputBudget.executionId}:reply-1`,
    );
    assert.equal(
      turnTwo.records[0]?.eventTurnId,
      `channel-reply:${second.outputBudget.executionId}:reply-1`,
    );
    assert.notEqual(turnOne.records[0]?.eventTurnId, turnTwo.records[0]?.eventTurnId);
    assert.equal(turnOne.posts.length, 1);
    assert.equal(turnTwo.posts.length, 1);
  });

  it("posts again when the prior delivery under the same key failed", async () => {
    const fixture = makeFixture({ priorDelivery: { status: "failed" } });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { message: "retry after a failed post", idempotencyKey: "reply-1" },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined);
    assert.equal(fixture.posts.length, 1);
    assert.equal(fixture.confirms.length, 1);
  });

  it("replays a posted row under the same key without posting twice", async () => {
    const fixture = makeFixture({
      priorDelivery: { status: "posted", externalMessageId: "1710000000.111" },
    });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { message: "duplicate call", idempotencyKey: "reply-1" },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined);
    const structured = (body.result as { structuredContent: Record<string, unknown> })
      .structuredContent;
    assert.equal(structured["replayed"], true);
    assert.equal(structured["messageId"], "1710000000.111");
    assert.equal(fixture.posts.length, 0);
  });

  it("refuses to re-post while a prior delivery under the same key is in flight", async () => {
    const fixture = makeFixture({ priorDelivery: { status: "recorded" } });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { message: "still in flight", idempotencyKey: "reply-1" },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, true);
    assert.equal(fixture.posts.length, 0);
  });

  // The channel binding path: ONE capability, one Agent, many turns. The
  // capability carries no durable output budget, so before the turn scope
  // existed the key fell back to the agent id and turn 2's "reply-1" read turn
  // 1's posted row — the second reply was answered "already posted" and never
  // reached the conversation.
  it("scopes the key to the turn, so the same key posts again on the next turn", async () => {
    const fixture = makeFixture({ turnId: "turn-1" });
    const send = async () =>
      await fixture.call("tools/call", {
        name: "message",
        arguments: { message: "answer", idempotencyKey: "reply-1" },
      });
    assert.equal(ToolResultSchema.parse((await send()).result).isError, undefined);
    // The plane steers the bound session; the capability follows the new turn.
    fixture.registry.noteTurn("agent-1", "turn-2");
    const second = await send();
    assert.equal(ToolResultSchema.parse(second.result).isError, undefined);
    assert.equal(
      (second.result as { structuredContent: Record<string, unknown> }).structuredContent[
        "replayed"
      ],
      undefined,
    );
    assert.deepEqual(
      fixture.records.map((record) => record.eventTurnId),
      ["channel-reply:turn-1:reply-1", "channel-reply:turn-2:reply-1"],
    );
    assert.equal(fixture.posts.length, 2, "both turns posted their reply");
  });

  it("replays the same key inside one turn without posting twice", async () => {
    const fixture = makeFixture({ turnId: "turn-1" });
    const send = async () =>
      await fixture.call("tools/call", {
        name: "message",
        arguments: { message: "answer", idempotencyKey: "reply-1" },
      });
    await send();
    const replay = await send();
    assert.equal(
      (replay.result as { structuredContent: Record<string, unknown> }).structuredContent[
        "replayed"
      ],
      true,
    );
    assert.equal(fixture.posts.length, 1);
  });

  // A send is several platform messages under one key. Replaying on the anchor
  // row alone reported a send whose attachment failed as `replayed: true`, so
  // the retry posted nothing and the file was lost.
  it("resumes a partly delivered send at its first undelivered message", async () => {
    const directory = await mkdtemp(join(tmpdir(), "channel-reply-partial-"));
    const first = join(directory, "first.txt");
    const second = join(directory, "second.txt");
    await writeFile(first, "one");
    await writeFile(second, "two");
    const posted: string[] = [];
    let failNext = true;
    const fixture = makeFixture({
      projectRoot: directory,
      mediaPost: async (_ref, file) => {
        if (file.fileName === "second.txt" && failNext) {
          failNext = false;
          return { ok: false, error: "upload_failed" };
        }
        posted.push(file.fileName);
        return { ok: true, externalMessageId: `file-${posted.length}`, mediaPosted: true };
      },
    });
    const send = async () =>
      await fixture.call("tools/call", {
        name: "message",
        arguments: {
          action: "send",
          message: "two files",
          idempotencyKey: "reply-1",
          attachments: [{ media: first }, { media: second }],
        },
      });
    assert.equal(ToolResultSchema.parse((await send()).result).isError, true);
    assert.deepEqual(posted, ["first.txt"]);
    const retry = await send();
    const structured = (retry.result as { structuredContent: Record<string, unknown> })
      .structuredContent;
    assert.equal(structured["replayed"], undefined, resultText(retry));
    assert.deepEqual(posted, ["first.txt", "second.txt"]);
    assert.equal(fixture.posts.length, 1, "the delivered text message is not posted twice");
    assert.deepEqual(
      fixture.confirms.map((confirm) => confirm.externalMessageId),
      ["1710000000.999999", "file-1", "file-2"],
    );
  });
});

// The channel binding path has no `agent_executions` row to spend a durable
// ceiling against, so the registry counts the turn's posts instead.
describe("channel-reply per-turn output ceiling", () => {
  it("refuses a send past the turn's ceiling and re-arms it on the next turn", async () => {
    const fixture = makeFixture({ turnId: "turn-1", turnOutputMax: 1 });
    const send = async () =>
      await fixture.call("tools/call", { name: "message", arguments: { text: "again" } });
    assert.equal(ToolResultSchema.parse((await send()).result).isError, undefined);
    const refused = await send();
    assert.equal(ToolResultSchema.parse(refused.result).isError, true);
    assert.match(resultText(refused), /output limit/);
    assert.equal(fixture.posts.length, 1);
    fixture.registry.noteTurn("agent-1", "turn-2");
    assert.equal(ToolResultSchema.parse((await send()).result).isError, undefined);
    assert.equal(fixture.posts.length, 2);
  });

  it("gives a refused send its reservation back", async () => {
    const fixture = makeFixture({
      turnId: "turn-1",
      turnOutputMax: 1,
      post: async () => ({ ok: false, error: "chat_not_found" }),
    });
    const failed = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "gone" },
    });
    assert.equal(ToolResultSchema.parse(failed.result).isError, true);
    const retry = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "gone" },
    });
    // The ceiling was not spent on a message nobody received: the retry is
    // admitted and fails on the channel, not on the budget.
    assert.match(resultText(retry), /chat_not_found/);
  });
});

function makeFixture(
  options: {
    post?: ChannelReplyPost;
    mediaPost?: ChannelReplyMediaPost;
    projectRoot?: string | null;
    ref?: ChannelReplyBindingRef;
    requestToken?: string;
    outputBudget?: ChannelReplyOutputBudget;
    outputStore?: ChannelReplyMcp["outputStore"];
    /** The turn the capability is minted for (the plane's per-inbound id). */
    turnId?: string;
    /** The channel path's per-turn output ceiling. */
    turnOutputMax?: number;
    /** A prior ledger row under the same key, as `recordDelivery` reports it. */
    priorDelivery?: { status: string; externalMessageId?: string };
  } = {},
): Fixture {
  const token = TOKEN;
  const registry = new ChannelReplyCapabilityRegistry({
    token: () => token,
    ...(options.turnOutputMax === undefined ? {} : { turnOutputMax: options.turnOutputMax }),
  });
  const capabilityToken = registry.issue(
    capabilityInput({
      ref: options.ref ?? REF,
      projectRoot: options.projectRoot === undefined ? process.cwd() : options.projectRoot,
      ...(options.outputBudget === undefined ? {} : { outputBudget: options.outputBudget }),
      ...(options.turnId === undefined ? {} : { turnId: options.turnId }),
    }),
  );
  assert.equal(registry.bind(capabilityToken, "agent-1"), true);
  const requestToken = options.requestToken ?? capabilityToken;
  const posts: OutboundPostParams[] = [];
  const post: ChannelReplyPost =
    options.post ??
    (async (ref, text, sent) => {
      posts.push({
        channel: ref.channel,
        accountId: ref.accountId,
        to: ref.externalConversationId,
        ...(ref.externalThreadId !== null ? { threadId: ref.externalThreadId } : {}),
        text,
        ...(sent?.presentation === undefined ? {} : { presentation: sent.presentation }),
      });
      return { ok: true, externalMessageId: "1710000000.999999" } satisfies OutboundPostResult;
    });
  const records: Array<{ eventTurnId: string; sequence: number }> = [];
  const confirms: Array<{ eventTurnId: string; externalMessageId: string }> = [];
  const failures: Array<{ eventTurnId: string; failureReason: string }> = [];
  // The delivery ledger, as a map keyed like the table. Real rows are what makes
  // the multi-message decisions (partial send, resumed retry) testable at all.
  const rows = new Map<string, { status: string; externalMessageId: string | null }>();
  const rowKey = (eventTurnId: string, sequence: number) => `${eventTurnId}:${sequence}`;
  const store = {
    recordDelivery: async (input: {
      eventTurnId: string;
      sequence: number;
    }): Promise<{ created: boolean; record?: unknown }> => {
      records.push({ eventTurnId: input.eventTurnId, sequence: input.sequence });
      // A seeded prior row is reported verbatim: `ChannelStore.recordDelivery`
      // re-arms a `failed` row itself and would report it created, so answering
      // `created: false` here exercises this file's own decision table.
      if (options.priorDelivery !== undefined && input.sequence === 0) {
        return { created: false, record: options.priorDelivery };
      }
      const existing = rows.get(rowKey(input.eventTurnId, input.sequence));
      if (existing === undefined || existing.status === "failed") {
        rows.set(rowKey(input.eventTurnId, input.sequence), {
          status: "recorded",
          externalMessageId: existing?.externalMessageId ?? null,
        });
        return { created: true };
      }
      return { created: false, record: existing };
    },
    listTurnDeliveries: async (
      _organizationId: string,
      _accountId: string,
      _externalConversationId: string,
      _externalThreadId: string | null,
      eventTurnId: string,
    ): Promise<unknown[]> =>
      [...rows.entries()]
        .filter(([key]) => key.startsWith(`${eventTurnId}:`))
        .map(([key, row]) =>
          Object.assign({}, row, { sequence: Number(key.slice(eventTurnId.length + 1)) }),
        )
        .sort((left, right) => left.sequence - right.sequence),
    confirmDelivery: async (input: {
      eventTurnId: string;
      sequence: number;
      externalMessageId: string;
    }): Promise<unknown> => {
      confirms.push({ eventTurnId: input.eventTurnId, externalMessageId: input.externalMessageId });
      rows.set(rowKey(input.eventTurnId, input.sequence), {
        status: "posted",
        externalMessageId: input.externalMessageId,
      });
      return {};
    },
    failDelivery: async (input: {
      eventTurnId: string;
      sequence: number;
      failureReason: string;
    }): Promise<unknown> => {
      failures.push({ eventTurnId: input.eventTurnId, failureReason: input.failureReason });
      rows.set(rowKey(input.eventTurnId, input.sequence), {
        status: "failed",
        externalMessageId: null,
      });
      return {};
    },
  } as unknown as ChannelStore;
  const server = createChannelReplyServer({
    organizationId: "org-1",
    store,
    resolveCapability: (candidate) => registry.resolve(candidate, "org-1"),
    reserveTurnOutput: (candidate) => registry.reserveTurnOutput(candidate),
    ...(options.outputStore === undefined ? {} : { outputStore: options.outputStore }),
    post,
    ...(options.mediaPost === undefined ? {} : { mediaPost: options.mediaPost }),
  });
  let id = 0;
  return {
    server,
    registry,
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
    outputBudget?: ChannelReplyOutputBudget;
    turnId?: string;
  } = {},
) {
  return {
    organizationId: "org-1",
    channelRevisionId: "revision-1",
    routePosition: 0,
    routeFingerprint: "route-a",
    ref: options.ref ?? REF,
    // The inbound sender the turn was opened by; the Hub issues the capability
    // with it and never takes it from the model.
    requesterSenderId: REQUESTER_SENDER_ID,
    ...(options.outputBudget === undefined ? {} : { outputBudget: options.outputBudget }),
    ...(options.turnId === undefined ? {} : { turnId: options.turnId }),
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

describe("Channel tool output budget", () => {
  it("shares one durable ceiling across concurrent MCP sends and the Hub output surface", async () => {
    const { database, outputBudget } = await outputBudgetFixture();
    const fixture = makeFixture({ outputBudget, outputStore: database });
    const results = await Promise.all([
      fixture.call("tools/call", { name: "message", arguments: { text: "one" } }),
      fixture.call("tools/call", { name: "message", arguments: { text: "two" } }),
    ]);
    assert.equal(results.filter((body) => ToolResultSchema.parse(body.result).isError).length, 1);
    assert.equal(fixture.posts.length, 1);
    assert.deepEqual(
      (await database.findAgentExecutionById(outputBudget.executionId))?.outputEmissions,
      { "slack.reply": 1 },
    );
    assert.equal(
      await database.beginAgentExecutionOutput(
        outputBudget.executionId,
        "slack.reply",
        1,
        new Date(),
      ),
      undefined,
    );
  });

  it("rejects MCP when another output surface already reserved the last send", async () => {
    const { database, outputBudget } = await outputBudgetFixture();
    assert.ok(
      await database.beginAgentExecutionOutput(
        outputBudget.executionId,
        "slack.reply",
        1,
        new Date(),
      ),
    );
    const fixture = makeFixture({ outputBudget, outputStore: database });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "bypass" },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, true);
    assert.equal(fixture.posts.length, 0);
  });

  it("spends one reply-ceiling attempt for a send that posts text and a file", async () => {
    const { database, outputBudget } = await outputBudgetFixture();
    const root = await mkdtemp(join(tmpdir(), "channel-budget-"));
    const file = join(root, "report.txt");
    await writeFile(file, "Report");
    let mediaCalls = 0;
    const fixture = makeFixture({
      outputBudget,
      outputStore: database,
      projectRoot: root,
      mediaPost: async () => {
        mediaCalls += 1;
        return { ok: true, externalMessageId: "file-9", mediaPosted: true };
      },
    });
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "send", attachments: [{ media: file }], message: "Extra send" },
    });
    assert.equal(ToolResultSchema.parse(body.result).isError, undefined);
    assert.equal(mediaCalls, 1);
    // The caption is the reply body: its own platform message, its own ledger
    // row, one shared output attempt.
    assert.deepEqual(
      fixture.posts.map((post) => post.text),
      ["Extra send"],
    );
    assert.deepEqual(
      fixture.records.map((record) => record.sequence),
      [0, 1],
    );
    assert.equal(fixture.confirms.length, 2);
    const next = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "bypass" },
    });
    assert.equal(ToolResultSchema.parse(next.result).isError, true);
  });

  it("releases a rejected send for retry without recording a successful output", async () => {
    const { database, outputBudget } = await outputBudgetFixture();
    let attempts = 0;
    const fixture = makeFixture({
      outputBudget,
      outputStore: database,
      post: async () => {
        attempts += 1;
        return attempts === 1 ? { ok: false, error: "chat_not_found" } : { ok: true };
      },
    });
    const failed = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "first" },
    });
    assert.equal(ToolResultSchema.parse(failed.result).isError, true);
    assert.deepEqual(
      (await database.findAgentExecutionById(outputBudget.executionId))?.outputEmissions,
      {},
    );
    const retried = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "second" },
    });
    assert.equal(ToolResultSchema.parse(retried.result).isError, undefined);
    assert.equal(attempts, 2);
  });

  it("fails closed without output accounting and retains an ambiguous send's pending lease", async () => {
    const { database, outputBudget } = await outputBudgetFixture();
    const missingStore = makeFixture({ outputBudget });
    const denied = await missingStore.call("tools/call", {
      name: "message",
      arguments: { text: "no store" },
    });
    assert.equal(ToolResultSchema.parse(denied.result).isError, true);
    assert.equal(missingStore.posts.length, 0);
    let attempts = 0;
    const fixture = makeFixture({
      outputBudget,
      outputStore: database,
      post: async () => {
        attempts += 1;
        throw new Error("transport closed after send");
      },
    });
    await fixture.call("tools/call", { name: "message", arguments: { text: "maybe sent" } });
    const retry = await fixture.call("tools/call", {
      name: "message",
      arguments: { text: "retry" },
    });
    assert.equal(ToolResultSchema.parse(retry.result).isError, true);
    assert.equal(attempts, 1);
  });
});

async function outputBudgetFixture() {
  const database = createMemoryDatabase();
  const workflow = await database.saveOrganizationTrigger({
    organizationId: "org-1",
    name: "channel-budget",
    enabled: true,
    format: "single_run",
    yaml: "",
    normalizedConfiguration: {},
    contentHash: "hash",
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    createdByUserId: null,
    routes: [],
  });
  const machine = await database.insertMachine({
    orgId: "org-1",
    source: { kind: "daemon", daemonId: "daemon" },
    status: "alive",
  });
  const execution = await database.insertAgentExecution({
    organizationId: "org-1",
    workflowId: workflow.id,
    machineId: machine.id,
    triggerContext: null,
    outputContext: null,
    configurationRevisionId: workflow.activeRevisionId,
  });
  return { database, outputBudget: { executionId: execution.id, type: "slack.reply", max: 1 } };
}

// --- The portable presentation, tool call to Block Kit (wave 6b) -------------
//
// The `message` tool's `presentation` used to be flattened into text before the
// vertical saw it: core materializes the fallback for any plugin that does not
// declare native rendering, and the Hub's post seam carried text only. These
// cases drive the whole tool path against the REAL built Slack vertical with a
// fake Web API, so the blocks asserted are the ones Slack would receive.
import { slackPlugin } from "@getpaseo/channels-slack/dist/plugin.js";
import {
  registerSlackWriteClientForTest,
  slackWebClientStubForTest,
  type WebClient,
} from "@getpaseo/channels-slack/dist/client/web-api.js";

const SLACK_PRESENTATION_TOKEN = "xoxb-channel-reply-presentation";
const SLACK_PRESENTATION_CFG = {
  channels: {
    slack: { accounts: { work: { botToken: SLACK_PRESENTATION_TOKEN, config: {} } } },
  },
};

interface SlackPostArgs {
  channel: string;
  text?: string;
  thread_ts?: string;
  blocks?: Record<string, unknown>[];
}

/** The supervisor's `postFor` against the real vertical: it hands the seam's
 * `presentation` to `plugin.outbound.sendText`, which compiles the blocks. */
function slackPresentationPost(posts: SlackPostArgs[]): ChannelReplyPost {
  const client = {
    ...slackWebClientStubForTest(),
    auth: {
      async test() {
        return { ok: true, user_id: "U_BOT" } as never;
      },
    },
    chat: {
      async postMessage(args: SlackPostArgs) {
        posts.push(args);
        return { ok: true, ts: `1788800100.00000${posts.length}`, channel: args.channel } as never;
      },
      async update() {
        return { ok: true } as never;
      },
    },
  } as WebClient;
  registerSlackWriteClientForTest(SLACK_PRESENTATION_TOKEN, client);
  const sendText = slackPlugin.outbound?.["sendText"] as (
    args: Record<string, unknown>,
  ) => Promise<{ messageId: string }>;
  return async (ref, text, options) => {
    const sent = await sendText({
      cfg: SLACK_PRESENTATION_CFG,
      accountId: ref.accountId,
      to: ref.externalConversationId,
      ...(ref.externalThreadId === null ? {} : { threadId: ref.externalThreadId }),
      text,
      client,
      ...(options?.presentation === undefined ? {} : { presentation: options.presentation }),
    });
    return { ok: true, externalMessageId: String(sent.messageId) };
  };
}

describe("presentation on the tool path", () => {
  afterEach(() => {
    clearChannelMessageActions(SLACK_WORK);
    forgetChannelMessageToolCatalog(SLACK_WORK);
  });

  /** The fixture with the real Slack vertical registered for the bound account. */
  function slackFixture(posts: SlackPostArgs[]): Fixture {
    registerChannelMessageActions(SLACK_WORK, slackPlugin as never);
    forgetChannelMessageToolCatalog(SLACK_WORK);
    return makeFixture({ post: slackPresentationPost(posts) });
  }

  async function sendPresentation(
    fixture: Fixture,
    presentation: unknown,
    text: string,
  ): Promise<{ structuredContent: Record<string, unknown>; text: string }> {
    const body = await fixture.call("tools/call", {
      name: "message",
      arguments: { action: "send", text, presentation },
    });
    assert.equal(body.error, undefined);
    const result = z
      .object({
        isError: z.boolean().optional(),
        structuredContent: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .parse(body.result);
    assert.equal(result.isError, undefined, resultText(body));
    return { structuredContent: result.structuredContent ?? {}, text: resultText(body) };
  }

  it("posts a chart and a table as native Slack blocks", async () => {
    const posts: SlackPostArgs[] = [];
    const sent = await sendPresentation(
      slackFixture(posts),
      {
        blocks: [
          {
            type: "chart",
            chartType: "bar",
            title: "Weekly runs",
            categories: ["Mon", "Tue", "Wed"],
            series: [{ name: "runs", values: [3, 5, 4] }],
          },
          { type: "table", caption: "Totals", headers: ["A", "B"], rows: [[1, 2]] },
        ],
      },
      "W6BCHART-OK",
    );
    assert.equal(sent.structuredContent["ok"], true);
    assert.equal(sent.structuredContent["presentationNotes"], undefined);
    const blocks = posts.flatMap((post) => post.blocks ?? []);
    const types = blocks.map((block) => block["type"]);
    assert.ok(types.includes("data_visualization"), `chart block missing: ${types.join()}`);
    assert.ok(types.includes("data_table"), `table block missing: ${types.join()}`);
    // Every post stays inside the capability's thread and keeps the text fallback.
    assert.ok(posts.every((post) => post.thread_ts === REF.externalThreadId));
    assert.ok(posts.some((post) => (post.text ?? "").includes("W6BCHART-OK")));
  });

  it("repairs a caption-less table and says so in the tool result", async () => {
    const posts: SlackPostArgs[] = [];
    const sent = await sendPresentation(
      slackFixture(posts),
      { blocks: [{ type: "table", headers: ["Run", "Status"], rows: [["a", "ok"]] }] },
      "W6BTABLE-OK",
    );
    // Core's normalizer refuses a caption-less table and the schema marks the
    // caption optional, so the data used to vanish with no block and no error.
    const notes = sent.structuredContent["presentationNotes"] as Array<Record<string, unknown>>;
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.["index"], 0);
    assert.equal(notes[0]?.["type"], "table");
    assert.equal(notes[0]?.["outcome"], "repaired");
    assert.match(sent.text, /repaired/u);
    const table = posts
      .flatMap((post) => post.blocks ?? [])
      .find((block) => block["type"] === "data_table");
    assert.equal(table?.["caption"], "Run");
  });

  it("reports a block the normalizer refuses instead of dropping it silently", async () => {
    const posts: SlackPostArgs[] = [];
    const sent = await sendPresentation(
      slackFixture(posts),
      // Duplicate categories break the portable chart contract; nothing can
      // repair it, so the send goes out as text and the note says why.
      {
        blocks: [
          {
            type: "chart",
            chartType: "bar",
            title: "Weekly runs",
            categories: ["Mon", "Mon"],
            series: [{ name: "runs", values: [1, 2] }],
          },
        ],
      },
      "W6BREJECT-OK",
    );
    const notes = sent.structuredContent["presentationNotes"] as Array<Record<string, unknown>>;
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.["outcome"], "rejected");
    assert.match(sent.text, /rejected/u);
    assert.equal(sent.structuredContent["ok"], true);
    assert.deepEqual(
      posts.flatMap((post) => post.blocks ?? []).filter((block) => block["type"] !== "rich_text"),
      [],
    );
  });
});
