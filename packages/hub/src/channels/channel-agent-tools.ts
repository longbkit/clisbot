// The Hub's edge of a vertical's CHANNEL-SPECIFIC agent tools — the tools that
// are not the universal `message` tool (slice 15b: Feishu's `feishu_*`
// families).
//
// Upstream registers them through the OpenClaw plugin host's `registerFull(api)`
// and the host owns the resulting catalog. Fusion has no plugin host: the Hub's
// channel-reply MCP server is the tool surface, one server per Channel reply
// capability, so this module is the adapter between the two.
//
// Three rules the ported tools depend on, and the reason this file is not a
// catalog:
//
//  1. AUTHORIZATION IS RE-RESOLVED PER CALL, NEVER CACHED. Every list and every
//     call re-runs the vertical's `collect` against the account's CURRENT drive
//     `cfg`, so a config revision that turns a tool family off takes effect on
//     the next call, and each executor still re-checks the account and its read
//     policy inside itself. Nothing derived from `cfg` is memoized here.
//  2. A registration is a tool OR a factory `(ctx) => tool | tool[]`. The
//     factory runs per execution with the Hub's `OpenClawPluginToolContext`;
//     building it once and keeping the result would freeze the context.
//  3. The result is untrusted external content (`resultContentSource:
//     "network"`). The boundary markers the ported `tool-result.ts` wraps a
//     payload in are passed through to the model verbatim.
//
// Only a capability bound to an account whose loaded vertical publishes
// `plugin.agentTools` lists anything at all; every other channel lists nothing.

import type { AnyAgentTool } from "@getpaseo/channels-core/agents/tools/common.host-adapter";
import type {
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
  OpenClawPluginToolOptions,
} from "@getpaseo/channels-core/plugin-sdk/plugin-entry";
import type { OpenClawConfig } from "@getpaseo/channels-core/channels/plugins/types.public.host-adapter";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { formatErrorMessage } from "@getpaseo/channels-core/infra/errors";
import type { ChannelReplyCapability } from "./channel-reply-capabilities.js";
import { getChannelDriveConfig, type ChannelAccountScope } from "./message-actions.js";

export type { ChannelAccountScope };

/** One registration, exactly as the vertical's registrar produces it. */
interface ChannelToolRegistration {
  tool: AnyAgentTool | OpenClawPluginToolFactory;
  options?: OpenClawPluginToolOptions;
}

/** The `plugin.agentTools` slot a vertical publishes (Feishu's `fusion/tools.ts`). */
interface ChannelAgentToolsSurface {
  names: readonly string[];
  collect(params: { cfg: OpenClawConfig }): ChannelToolRegistration[];
}

const registry = new Map<string, ChannelAgentToolsSurface>();

/**
 * One process serves every organization, so the account id alone is not a
 * name: two tenants that both call their workspace `support` would share one
 * entry, and whichever loaded last would decide which tools the other's agents
 * can call. The organization is part of the key for that reason — the same
 * scope the action adapter and the drive-time cfg are keyed by.
 */
function key(scope: ChannelAccountScope): string {
  return `${scope.organizationId}:${scope.channel}:${scope.accountId}`;
}

function readAgentToolsSurface(
  plugin: Record<string, unknown> | undefined,
): ChannelAgentToolsSurface | undefined {
  const candidate = plugin?.["agentTools"];
  if (candidate === null || typeof candidate !== "object") return undefined;
  const surface = candidate as Partial<ChannelAgentToolsSurface>;
  return typeof surface.collect === "function" && Array.isArray(surface.names)
    ? (surface as ChannelAgentToolsSurface)
    : undefined;
}

/** Registers a loaded vertical's channel tools for one account. */
export function registerChannelAgentTools(
  scope: ChannelAccountScope,
  plugin: Record<string, unknown> | undefined,
): void {
  const surface = readAgentToolsSurface(plugin);
  if (surface === undefined) {
    registry.delete(key(scope));
    return;
  }
  registry.set(key(scope), surface);
}

/** Drops an account's channel tools when its vertical is disposed. */
export function clearChannelAgentTools(scope: ChannelAccountScope): void {
  registry.delete(key(scope));
}

/** Every tool name the account's vertical could register, for discovery. */
export function channelAgentToolNames(scope: ChannelAccountScope): readonly string[] {
  return registry.get(key(scope))?.names ?? [];
}

/** The tools the account's live config actually registers, built with `context`. */
function buildTools(
  scope: ChannelAccountScope,
  context: OpenClawPluginToolContext,
): AnyAgentTool[] {
  const surface = registry.get(key(scope));
  if (surface === undefined) return [];
  const cfg = getChannelDriveConfig(scope);
  const tools: AnyAgentTool[] = [];
  for (const entry of surface.collect({ cfg })) {
    const built = typeof entry.tool === "function" ? entry.tool(context) : entry.tool;
    if (built === null || built === undefined) continue;
    for (const tool of Array.isArray(built) ? built : [built]) tools.push(tool);
  }
  return tools;
}

/** The context every factory and executor receives for one capability. */
export interface ChannelAgentToolContext extends ChannelAccountScope {
  /** The conversation the capability is bound to. */
  conversation: { to: string; threadId?: string | undefined };
  /** The Project root the Agent runs in, when it has one. */
  workspaceDir?: string | undefined;
  /** The inbound sender, for the executors' own requester checks. */
  requesterSenderId?: string | undefined;
}

function toolContext(context: ChannelAgentToolContext): OpenClawPluginToolContext {
  return {
    config: getChannelDriveConfig(context),
    // The Hub never lets a channel tool leave the Agent's Project root.
    fsPolicy: { workspaceOnly: true },
    ...(context.workspaceDir === undefined ? {} : { workspaceDir: context.workspaceDir }),
    messageChannel: context.channel,
    agentAccountId: context.accountId,
    deliveryContext: {
      channel: context.channel,
      accountId: context.accountId,
      to: context.conversation.to,
      ...(context.conversation.threadId === undefined
        ? {}
        : { threadId: context.conversation.threadId }),
    },
    nativeChannelId: context.conversation.to,
    ...(context.requesterSenderId === undefined
      ? {}
      : { requesterSenderId: context.requesterSenderId }),
    // The Agent acts for the inbound requester, never as a direct operator, so
    // the ported conversation-read policy applies its delegated visibility rules.
    conversationReadOrigin: "delegated",
  };
}

/** One MCP tool descriptor, as the channel-reply server lists it. */
export interface ChannelAgentToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const EMPTY_SCHEMA = { type: "object", properties: {} } as const;

/** The account's channel tools, resolved fresh from the live config. */
export function listChannelAgentTools(
  context: ChannelAgentToolContext,
): ChannelAgentToolDescriptor[] {
  return buildTools(context, toolContext(context)).map((tool) => ({
    name: tool.name,
    description: tool.description ?? tool.label ?? tool.name,
    inputSchema:
      tool.parameters !== null && typeof tool.parameters === "object"
        ? (tool.parameters as Record<string, unknown>)
        : { ...EMPTY_SCHEMA },
  }));
}

/** True when the account currently registers a tool by this name. */
export function isChannelAgentTool(context: ChannelAgentToolContext, name: string): boolean {
  return channelAgentToolNames(context).includes(name);
}

export type ChannelAgentToolOutcome =
  | { ok: true; content: { type: "text"; text: string }[]; details?: unknown }
  | { ok: false; error: string };

/**
 * Runs one channel tool. The factory is rebuilt for this call, so the tool the
 * model reaches is the one the account's current config authorizes — a family
 * disabled since the list call is simply not there any more.
 */
export async function callChannelAgentTool(
  context: ChannelAgentToolContext,
  name: string,
  args: Record<string, unknown>,
  toolCallId: string,
): Promise<ChannelAgentToolOutcome> {
  const tool = buildTools(context, toolContext(context)).find(
    (candidate) => candidate.name === name,
  );
  if (tool === undefined || tool.execute === undefined) {
    return { ok: false, error: `${context.channel} does not currently offer the ${name} tool` };
  }
  try {
    const result = await tool.execute(toolCallId, args);
    const content = result.content.flatMap((entry: { type: string; text?: string }) =>
      entry.type === "text" ? [{ type: "text" as const, text: entry.text ?? "" }] : [],
    );
    return {
      ok: true,
      content,
      ...(result.details === undefined ? {} : { details: result.details }),
    };
  } catch (error) {
    // A vertical's error text carries whatever its HTTP client put in the
    // message; the ported redactor masks the credentials before the string
    // becomes tool output the model reads back.
    return { ok: false, error: formatErrorMessage(error) };
  }
}

// --- The channel-reply MCP bridge ---------------------------------------------

/**
 * The capability's binding, as the vertical's tool factories and executors read
 * it. Everything trusted comes from the SERVER-OWNED capability, never from the
 * model's arguments: the model cannot redirect a channel tool at another
 * conversation by naming one.
 */
export function agentToolContext(capability: ChannelReplyCapability): ChannelAgentToolContext {
  const { channel, accountId, externalConversationId, externalThreadId } = capability.ref;
  return {
    organizationId: capability.organizationId,
    channel,
    accountId,
    conversation: {
      to: externalConversationId,
      ...(externalThreadId === null ? {} : { threadId: externalThreadId }),
    },
    ...(capability.projectRoot === undefined ? {} : { workspaceDir: capability.projectRoot }),
    // The inbound sender the capability was issued for. Feishu's read policy
    // and Discord's guild-admin actions authorize against it; with no requester
    // at all they either fail closed or act unauthorized.
    ...(capability.requesterSenderId === undefined
      ? {}
      : { requesterSenderId: capability.requesterSenderId }),
  };
}

/** One channel-specific tool call, with the ported result passed through. */
export async function channelToolCall(
  context: ChannelAgentToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const outcome = await callChannelAgentTool(context, name, args, randomUUID());
  if (!outcome.ok) {
    return {
      content: [{ type: "text" as const, text: outcome.error }],
      structuredContent: { ok: false, error: outcome.error },
      isError: true,
    };
  }
  return {
    // The ported executors mark network results as untrusted external content;
    // their boundary markers reach the model unchanged.
    content: outcome.content,
    ...(outcome.details === undefined ? {} : { structuredContent: asStructured(outcome.details) }),
  };
}

/** MCP structured content must be a JSON object; anything else rides as text. */
function asStructured(details: unknown): Record<string, unknown> {
  return details !== null && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : { result: details };
}
