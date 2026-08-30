// The hub-side channel-reply MCP tool (E4/E6): the `message` tool a tool-path
// agent session gets through the control-plane agent-spec resolver. The Hub
// serves it on its own loopback HTTP server at
// `POST /mcp/channel/<opaque-binding-ref>` — the same trusted-client
// loopback trust boundary as the channel ops (a Bearer token must equal the
// instance auth secret; without one, the caller address must be loopback).
//
// The tool posts through the SAME outbound seam the relay uses (the
// vertical's `sendText` via the supervisor's `postFor`) and records a
// delivery-ledger row before posting (record-before-post, like the relay).
// The binding ref names the account + thread the session was created from:
// it is embedded in the mcpServers URL at create time, so the endpoint is
// create-time-only — no daemon RPC attaches an MCP server to an existing
// session, and pre-existing agents outside the channel plane never get the
// tool. Unknown or malformed refs return a clean tool error, never a 500.
//
// Stateless MCP (SDK `WebStandardStreamableHTTPServerTransport` without a
// sessionIdGenerator), one per-request Server + transport, closed on the
// response lifecycle — the execution-capabilities server's shape.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { evaluateOutboundMedia, mediaFileName } from "@getpaseo/channels-shared";
import { ChannelStore } from "../db/channels.js";
import { registerResponseLifecycle } from "../http/response-lifecycle.js";
import { reportFailure } from "../failures/index.js";
import {
  CHANNEL_REPLY_TOOL_NAME,
  CHANNEL_REPLY_FILE_TOOL_NAME,
  decodeChannelReplyBindingRef,
  type ChannelReplyBindingRef,
  type ChannelReplyFilePostFn,
  type OutboundPostResult,
} from "./plane/types.js";

/** The seam the supervisor threads: the account's outbound post, addressed by
 * the decoded binding ref (the vertical's `sendText` through `postFor`). */
export type ChannelReplyPost = (
  ref: ChannelReplyBindingRef,
  text: string,
) => Promise<OutboundPostResult>;

/** Everything one `message` call needs: the org-scoped ledger + the post. */
export interface ChannelReplyMcp {
  organizationId: string;
  store: ChannelStore;
  post: ChannelReplyPost;
  mediaPost?: ChannelReplyFilePostFn;
  homeRoot?: string;
}

export interface ChannelReplyServer {
  /** One MCP request against the channel-reply endpoint; `token` is the URL
   * binding-ref segment (`/mcp/channel/<token>`). */
  handle(request: Request, token: string): Promise<Response>;
}

export function createChannelReplyServer(mcp: ChannelReplyMcp): ChannelReplyServer {
  return {
    async handle(request, token) {
      const server = new Server(
        { name: "paseo-hub-channel-reply", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [messageTool(), fileTool()],
      }));
      server.setRequestHandler(CallToolRequestSchema, async (call) => {
        if (call.params.name === CHANNEL_REPLY_FILE_TOOL_NAME) {
          return fileCall(mcp, token, call.params.arguments ?? {});
        }
        if (call.params.name !== CHANNEL_REPLY_TOOL_NAME) {
          return toolFailure(`Tool ${call.params.name} not found`);
        }
        return messageCall(mcp, token, call.params.arguments ?? {});
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        // Omitting sessionIdGenerator is the SDK's stateless-mode setting.
        enableJsonResponse: true,
        enableDnsRebindingProtection: false,
      });
      let responseLifecycleRegistered = false;
      const close = async (): Promise<void> => {
        try {
          await server.close();
          await transport.close();
        } catch (error) {
          reportFailure(error, {
            operation: "channel_reply.mcp.close",
            component: "channels",
          });
        }
      };
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(request);
        responseLifecycleRegistered = true;
        return registerResponseLifecycle(response, { onFinish: close, onAbort: close });
      } finally {
        if (!responseLifecycleRegistered) await close();
      }
    },
  };
}

/** The `message` tool's input schema: `action: "send"` (the only action),
 * `text` (non-empty), `final` (optional; false = progress, true/omitted =
 * the completed reply — the OpenClaw message-tool-only contract). */
function messageTool() {
  return {
    name: CHANNEL_REPLY_TOOL_NAME,
    description:
      "Post a message into the channel thread this session was created from. " +
      "Set final=false for progress; set final=true, or omit it, for the completed reply.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["send"] },
        text: { type: "string", minLength: 1 },
        final: { type: "boolean" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  };
}

async function messageCall(
  mcp: ChannelReplyMcp,
  token: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const ref = decodeChannelReplyBindingRef(token);
  if (ref === undefined) return toolFailure("unknown or malformed channel binding ref");
  const action = "action" in args ? args["action"] : "send";
  if (action !== "send") return toolFailure(`unsupported action ${String(action)}`);
  const text = args["text"];
  if (typeof text !== "string" || text.trim() === "") {
    return toolFailure("`text` must be a non-empty string");
  }
  // Record-before-post: the ledger row lands before the channel post; a
  // fresh UUID per call so retries of the same logical reply are new posts
  // (the agent drives them), while a replayed row (never, in this shape)
  // would dedupe by event/turn id + sequence.
  const eventTurnId = `channel-reply:${randomUUID()}`;
  const recorded = await mcp.store.recordDelivery({
    organizationId: mcp.organizationId,
    channel: ref.channel,
    accountId: ref.accountId,
    externalConversationId: ref.externalConversationId,
    externalThreadId: ref.externalThreadId,
    eventTurnId,
    sequence: 0,
  });
  if (!recorded.created) return toolFailure("delivery already recorded; not re-posting");
  const result = await mcp.post(ref, text);
  if (!result.ok) {
    await mcp.store.failDelivery({
      organizationId: mcp.organizationId,
      accountId: ref.accountId,
      externalConversationId: ref.externalConversationId,
      externalThreadId: ref.externalThreadId,
      eventTurnId,
      sequence: 0,
      failureReason: result.error ?? "the channel post failed",
    });
    return toolFailure(`message post failed: ${result.error ?? "the channel post failed"}`);
  }
  await mcp.store.confirmDelivery({
    organizationId: mcp.organizationId,
    accountId: ref.accountId,
    externalConversationId: ref.externalConversationId,
    externalThreadId: ref.externalThreadId,
    eventTurnId,
    sequence: 0,
    externalMessageId: result.externalMessageId ?? "",
    postedAt: new Date(),
  });
  return toolSuccess("message posted");
}

function fileTool() {
  return {
    name: CHANNEL_REPLY_FILE_TOOL_NAME,
    description:
      "Send a local file to the user in this channel thread. Use it whenever you share an artifact (report, screenshot, video, voice note, document). Always pass an absolute path. Do NOT write file paths as links inside message text — the user cannot open them.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description:
            "Absolute path of the local file to send (document, image, video, or voice). Must live under your home directory.",
        },
        caption: { type: "string", description: "Optional short text posted after the file." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  };
}

// eslint-disable-next-line complexity -- one transaction owns validation, delivery, and rollback.
async function fileCall(
  mcp: ChannelReplyMcp,
  token: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const ref = decodeChannelReplyBindingRef(token);
  if (ref === undefined) return toolFailure("unknown or malformed channel binding ref");
  const filePath = args["path"];
  if (typeof filePath !== "string" || filePath.trim() === "")
    return toolFailure("`path` must be a non-empty string");
  if (!path.isAbsolute(filePath))
    return toolFailure("path must be an absolute path (e.g. /home/.../report.md)");
  // Fail closed when no home root is configured: absence of a root is never
  // "unrestricted access".
  if (mcp.homeRoot === undefined) {
    return toolFailure(
      "file sending is unavailable for this session: no home directory is configured",
    );
  }
  // Containment is checked AFTER symlink resolution on both sides: a lexical
  // check would let a link inside the home escape to a target outside it
  // (statSync follows symlinks). The canonical path is what gets uploaded.
  let homeRoot: string;
  try {
    homeRoot = realpathSync(mcp.homeRoot);
  } catch {
    return toolFailure(
      "file sending is unavailable for this session: the home directory does not exist",
    );
  }
  let target: string;
  try {
    target = realpathSync(filePath);
  } catch {
    return toolFailure(`file not found: ${filePath}`);
  }
  if (target !== homeRoot && !target.startsWith(`${homeRoot}${path.sep}`)) {
    return toolFailure("path is outside the allowed home directory");
  }
  let sizeBytes: number;
  try {
    const stat = statSync(target);
    if (!stat.isFile()) return toolFailure("not a regular file");
    sizeBytes = stat.size;
  } catch {
    return toolFailure(`file not found: ${filePath}`);
  }
  const decision = evaluateOutboundMedia({
    sizeBytes,
    channel: ref.channel,
    fileName: mediaFileName(target),
  });
  if (!decision.ok) return toolFailure(decision.notice);
  const eventTurnId = `channel-reply-file:${randomUUID()}`;
  const recorded = await mcp.store.recordDelivery({
    organizationId: mcp.organizationId,
    channel: ref.channel,
    accountId: ref.accountId,
    externalConversationId: ref.externalConversationId,
    externalThreadId: ref.externalThreadId,
    eventTurnId,
    sequence: 0,
  });
  if (!recorded.created) return toolFailure("delivery already recorded; not re-posting");
  if (mcp.mediaPost === undefined) {
    await mcp.store.failDelivery({
      organizationId: mcp.organizationId,
      accountId: ref.accountId,
      externalConversationId: ref.externalConversationId,
      externalThreadId: ref.externalThreadId,
      eventTurnId,
      sequence: 0,
      failureReason: "this channel does not support file sending",
    });
    return toolFailure("this channel does not support file sending");
  }
  const result = await mcp.mediaPost(ref, target);
  if (!result.ok) {
    await mcp.store.failDelivery({
      organizationId: mcp.organizationId,
      accountId: ref.accountId,
      externalConversationId: ref.externalConversationId,
      externalThreadId: ref.externalThreadId,
      eventTurnId,
      sequence: 0,
      failureReason: result.error ?? "the file post failed",
    });
    return toolFailure(result.error ?? "the file post failed");
  }
  await mcp.store.confirmDelivery({
    organizationId: mcp.organizationId,
    accountId: ref.accountId,
    externalConversationId: ref.externalConversationId,
    externalThreadId: ref.externalThreadId,
    eventTurnId,
    sequence: 0,
    externalMessageId: result.externalMessageId ?? "",
    postedAt: new Date(),
  });
  let success =
    result.mediaPosted === false
      ? "file was too large for the channel; posted an in-channel notice instead"
      : `file posted (${result.externalMessageId ?? ""})`;
  const caption = args["caption"];
  if (typeof caption === "string" && caption.trim() !== "") {
    const captionTurnId = `channel-reply:${randomUUID()}`;
    const captionRecorded = await mcp.store.recordDelivery({
      organizationId: mcp.organizationId,
      channel: ref.channel,
      accountId: ref.accountId,
      externalConversationId: ref.externalConversationId,
      externalThreadId: ref.externalThreadId,
      eventTurnId: captionTurnId,
      sequence: 0,
    });
    if (!captionRecorded.created) {
      success += " (caption failed: delivery already recorded; not re-posting)";
    } else {
      const captionResult = await mcp.post(ref, caption);
      if (!captionResult.ok) {
        await mcp.store.failDelivery({
          organizationId: mcp.organizationId,
          accountId: ref.accountId,
          externalConversationId: ref.externalConversationId,
          externalThreadId: ref.externalThreadId,
          eventTurnId: captionTurnId,
          sequence: 0,
          failureReason: captionResult.error ?? "the caption post failed",
        });
        success += ` (caption failed: ${captionResult.error ?? "the caption post failed"})`;
      } else {
        await mcp.store.confirmDelivery({
          organizationId: mcp.organizationId,
          accountId: ref.accountId,
          externalConversationId: ref.externalConversationId,
          externalThreadId: ref.externalThreadId,
          eventTurnId: captionTurnId,
          sequence: 0,
          externalMessageId: captionResult.externalMessageId ?? "",
          postedAt: new Date(),
        });
      }
    }
  }
  return toolSuccess(success);
}

function toolSuccess(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function toolFailure(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
