// The hub-side channel-reply MCP tool (E4/E6): the `message` tool a tool-path
// agent session gets through the control-plane agent-spec resolver. The Hub
// serves it on its own loopback HTTP server at
// `POST /mcp/channel/<opaque-capability>`. A local Agent reaches it over
// loopback; a remote managed Agent presents the unguessable URL capability.
//
// The tool posts through the SAME outbound seam the relay uses (the
// vertical's `sendText` via the supervisor's `postFor`) and records a
// delivery-ledger row before posting (record-before-post, like the relay).
// Routing facts stay in the supervisor-owned capability registry and never
// enter the URL. The capability is embedded at create time and bound to the
// created Agent; unknown, expired, and revoked tokens return a clean tool
// error, never a 500.
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
import { ChannelStore } from "../db/channels.js";
import type { Database } from "../db/types.js";
import { registerResponseLifecycle } from "../http/response-lifecycle.js";
import { reportFailure } from "../failures/index.js";
import {
  CHANNEL_REPLY_TOOL_NAME,
  type ChannelReplyBindingRef,
  type MediaPostResult,
  type OutboundPostResult,
} from "./plane/types.js";
import type { StagedChannelMedia } from "./media/outbound-stager.js";
import type { MessagePresentation } from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";
import { executeChannelSend, type ChannelReplyOutputAttempt } from "./channel-reply-send.js";
import { errorText, toolFailure, unsupportedAction } from "./channel-reply-results.js";
import {
  accountScope,
  type ChannelReplyCapability,
  type ChannelReplyTurnOutput,
} from "./channel-reply-capabilities.js";
import {
  agentToolContext,
  channelToolCall,
  isChannelAgentTool,
  listChannelAgentTools,
} from "./channel-agent-tools.js";
import {
  buildChannelMessageToolDescription,
  buildChannelMessageToolSchema,
  isExecutableMessageAction,
  listChannelMessageToolActions,
  readHostOnlyMessageToolFields,
} from "./channel-message-tool.js";
import {
  runChannelMessageAction,
  type ChannelAccountScope,
  type ChannelMessageActionOutcome,
} from "./message-actions.js";

/** What one post carries besides its text. `text` stays the message's fallback
 * rendering on every channel; a vertical that declares presentation support
 * renders the blocks instead (Slack Block Kit charts and tables). */
export interface ChannelReplyPostOptions {
  presentation?: MessagePresentation | undefined;
}

/** The seam the supervisor threads: the account's outbound post, addressed by
 * the capability's server-owned binding ref (the vertical's `sendText` through `postFor`). */
export type ChannelReplyPost = (
  ref: ChannelReplyBindingRef,
  text: string,
  options?: ChannelReplyPostOptions,
) => Promise<OutboundPostResult>;

/** The account's native-media post: one staged file per call, addressed by the
 * server-owned binding ref (the vertical's `outbound.sendMedia` through the
 * supervisor). `mediaPosted: false` means the vertical refused the file and
 * posted its oversize notice through the text path instead. */
export type ChannelReplyMediaPost = (
  ref: ChannelReplyBindingRef,
  file: StagedChannelMedia,
) => Promise<MediaPostResult>;

/** Everything one `message` call needs: the org-scoped ledger + the post. */
export interface ChannelReplyMcp {
  organizationId: string;
  store: ChannelStore;
  outputStore?: Pick<
    Database,
    "beginAgentExecutionOutput" | "completeAgentExecutionOutput" | "failAgentExecutionOutput"
  >;
  post: ChannelReplyPost;
  mediaPost?: ChannelReplyMediaPost;
  resolveCapability(token: string): ChannelReplyCapability | undefined;
  /** The per-turn output ceiling for a capability with no durable budget (the
   * channel binding path). Absent = that path posts unbounded. */
  reserveTurnOutput?(token: string): ChannelReplyTurnOutput | undefined;
  /** Operator surface for a capability the Hub cannot answer. A dead
   * capability used to be silent on both verbs, so a whole Agent could talk to
   * nobody without a single line in `hub.log` (D-W4-01). */
  log?: ChannelReplyLogger;
}

export interface ChannelReplyLogger {
  warn(message: string, detail?: Record<string, unknown>): void;
}

export interface ChannelReplyServer {
  /** True for a known, unexpired server-side capability (bound or pending). */
  accepts?(token: string): boolean;
  /** One MCP request against `/mcp/channel/<opaque-capability>`. */
  handle(request: Request, token: string): Promise<Response>;
}

export function createChannelReplyServer(mcp: ChannelReplyMcp): ChannelReplyServer {
  return {
    accepts: (token) => mcp.resolveCapability(token) !== undefined,
    async handle(request, token) {
      const server = new Server(
        { name: "paseo-hub-channel-reply", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, () => {
        const capability = mcp.resolveCapability(token);
        if (capability === undefined) {
          mcp.log?.warn("channel reply capability unknown", { verb: "tools/list" });
        }
        return {
          tools:
            capability === undefined
              ? []
              : [
                  messageTool(capability),
                  // Files ride the `message` tool's `attachments` exactly as
                  // upstream; there is no separate file tool.
                  // The vertical's own tools (Feishu's `feishu_*` families).
                  // Resolved on every list from the account's live config, so a
                  // family the operator turns off stops being advertised.
                  ...listChannelAgentTools(agentToolContext(capability)),
                ],
        };
      });
      server.setRequestHandler(CallToolRequestSchema, async (call) => {
        const capability = mcp.resolveCapability(token);
        if (capability === undefined) {
          mcp.log?.warn("channel reply capability unknown", {
            verb: "tools/call",
            tool: call.params.name,
          });
          return toolFailure("unknown, expired, or revoked channel reply capability");
        }
        if (call.params.name !== CHANNEL_REPLY_TOOL_NAME) {
          const context = agentToolContext(capability);
          if (!isChannelAgentTool(context, call.params.name)) {
            return toolFailure(`Tool ${call.params.name} not found`);
          }
          return channelToolCall(context, call.params.name, call.params.arguments ?? {});
        }
        return messageCall(mcp, capability, token, call.params.arguments ?? {});
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

/** The `message` tool, scoped to the capability's channel.
 *
 * The schema comes from the ported OpenClaw message-tool builders (see
 * `channel-message-tool.ts`): the channel's advertised actions and capabilities
 * decide which property groups appear, host and cross-destination fields are
 * removed, and Fusion's `text`/`idempotencyKey`/`final` contracts are merged in.
 * Only `send` executes today; see `messageCall`. */
function messageTool(capability: ChannelReplyCapability) {
  const scope = accountScope(capability);
  return {
    name: CHANNEL_REPLY_TOOL_NAME,
    description: buildChannelMessageToolDescription(capability.ref.channel, scope),
    inputSchema: buildChannelMessageToolSchema(capability.ref.channel, scope),
  };
}

/**
 * Gates one action name. `send` goes through the outbound seam; every other
 * executable action goes through the ported runner to the vertical's
 * `handleAction`. Anything else is refused loudly, never dropped silently.
 */
function checkMessageAction(
  scope: ChannelAccountScope,
  action: unknown,
): CallToolResult | undefined {
  if (typeof action !== "string") {
    return unsupportedAction(String(action), "`action` must be one of the advertised action names");
  }
  const channel = scope.channel as ChannelReplyBindingRef["channel"];
  if (isExecutableMessageAction(action, channel, scope)) return undefined;
  return unsupportedAction(
    action,
    listChannelMessageToolActions(channel, scope).includes(action)
      ? `${channel} advertises this action but the Hub outbound seam does not execute it yet`
      : `${channel} does not advertise this action`,
  );
}

/**
 * Refuses a call that carries a key only the Hub may set.
 *
 * The generated schema drops them, but a schema is a description: the model can
 * still write `dryRun: true` or a `target` of its own, and both used to reach
 * core's runner through the params spread — `dryRun` made the Hub record a
 * delivery, answer "posted" and post nothing.
 */
function checkHostOnlyFields(args: Record<string, unknown>): CallToolResult | undefined {
  const present = readHostOnlyMessageToolFields(args);
  if (present.length === 0) return undefined;
  const reason = `${present.join(", ")} ${present.length === 1 ? "is" : "are"} set by the Hub; this capability is bound to one conversation`;
  return {
    content: [{ type: "text" as const, text: `rejected: ${reason}` }],
    structuredContent: { ok: false, status: "host_only_field", fields: present, reason },
    isError: true,
  };
}

async function messageCall(
  mcp: ChannelReplyMcp,
  capability: ChannelReplyCapability,
  token: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const hostOnlyError = checkHostOnlyFields(args);
  if (hostOnlyError !== undefined) return hostOnlyError;
  const action = "action" in args ? args["action"] : "send";
  const actionError = checkMessageAction(accountScope(capability), action);
  if (actionError !== undefined) return actionError;
  if (action !== "send") {
    return await channelActionCall(mcp, capability, token, action as string, args);
  }
  return await executeChannelSend({
    mcp,
    capability,
    args,
    reserveOutput: () => reserveOutput(mcp, capability, token),
  });
}

/**
 * A non-send action: the ported runner normalizes the params, resolves the
 * target/thread against the capability's bound conversation, and
 * `dispatchChannelMessageAction` hands the call to the vertical's
 * `handleAction`. The delivery ledger stays out of it — only `send` posts a new
 * message; `react`/`edit`/`delete` and the rest act on messages that already
 * exist, so recording a delivery row for them would invent a message the channel
 * never received. A delivering action reports its native message id through
 * `structuredContent.messageId` instead.
 */
async function channelActionCall(
  mcp: ChannelReplyMcp,
  capability: ChannelReplyCapability,
  token: string,
  action: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const ref = capability.ref;
  const attempt = await reserveOutput(mcp, capability, token);
  if (attempt === undefined) return toolFailure("Channel reply output limit reached");
  let outcome: ChannelMessageActionOutcome;
  try {
    outcome = await runChannelMessageAction({
      ...accountScope(capability),
      action,
      params: { ...args },
      conversation: {
        to: ref.externalConversationId,
        ...(ref.externalThreadId === null ? {} : { threadId: ref.externalThreadId }),
      },
      // The turn's requester, so a ported executor that enforces channel-local
      // trust reads the inbound sender the capability was issued for.
      ...(capability.requesterSenderId === undefined
        ? {}
        : { requesterSenderId: capability.requesterSenderId }),
      // Only `send` reaches this seam; a non-send action that asks core for a
      // durable send is a vertical bug, and failing loudly is the honest answer.
      send: async (params) => await mcp.post(ref, params.text),
      ...(capability.outputBudget === undefined
        ? {}
        : { sessionId: capability.outputBudget.executionId }),
    });
  } catch (error) {
    await attempt.fail();
    return toolFailure(`message ${action} failed: ${errorText(error)}`);
  }
  if (!outcome.ok) {
    await attempt.fail();
    return {
      content: [{ type: "text" as const, text: outcome.toolText ?? `message ${action} failed` }],
      structuredContent: actionStructuredContent(ref, outcome),
      isError: true,
    };
  }
  await attempt.complete();
  return {
    content: [{ type: "text" as const, text: outcome.toolText ?? `message ${action} ok` }],
    structuredContent: actionStructuredContent(ref, outcome),
  };
}

/** Upstream's outcome, projected onto the tool's structured content. */
function actionStructuredContent(
  ref: ChannelReplyBindingRef,
  outcome: ChannelMessageActionOutcome,
): Record<string, unknown> {
  return {
    ok: outcome.ok,
    action: outcome.action,
    handledBy: outcome.handledBy,
    channel: ref.channel,
    accountId: ref.accountId,
    to: ref.externalConversationId,
    ...(ref.externalThreadId === null ? {} : { threadId: ref.externalThreadId }),
    ...(outcome.messageId === undefined ? {} : { messageId: outcome.messageId }),
    ...(outcome.sentBeforeError === true ? { sentBeforeError: true } : {}),
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
    ...(outcome.payload === undefined ? {} : { result: outcome.payload }),
  };
}

/**
 * Reserve before any external send; pending attempts count against the same
 * durable budget as Hub output tools and relay delivery. An ambiguous failure
 * retains its pending delivery lease, matching the existing output admission.
 *
 * `undefined` means the budget is spent. A capability issued without a durable
 * budget — the channel binding path, whose turns own no `agent_executions` row
 * — spends the registry's per-turn ceiling instead, so both paths have one
 * shape and neither posts without a reservation.
 */
async function reserveOutput(
  mcp: ChannelReplyMcp,
  capability: ChannelReplyCapability,
  token: string,
): Promise<ChannelReplyOutputAttempt | undefined> {
  const budget = capability.outputBudget;
  if (budget === undefined) return turnOutputAttempt(mcp, token);
  const attempt = await mcp.outputStore?.beginAgentExecutionOutput(
    budget.executionId,
    budget.type,
    budget.max,
    new Date(),
  );
  const attemptId = attempt?.id;
  if (attemptId === undefined) return undefined;
  return {
    complete: async () => {
      await mcp.outputStore?.completeAgentExecutionOutput(
        budget.executionId,
        attemptId,
        new Date(),
      );
    },
    fail: async () => {
      await mcp.outputStore?.failAgentExecutionOutput(budget.executionId, attemptId, new Date());
    },
  };
}

/** The channel path's ceiling, as one output attempt. No registry seam means no
 * ceiling — the call proceeds, as it did before the ceiling existed. */
function turnOutputAttempt(
  mcp: ChannelReplyMcp,
  token: string,
): ChannelReplyOutputAttempt | undefined {
  if (mcp.reserveTurnOutput === undefined) {
    return { complete: async () => {}, fail: async () => {} };
  }
  const reserved = mcp.reserveTurnOutput(token);
  if (reserved === undefined) return undefined;
  return {
    complete: async () => reserved.complete(),
    fail: async () => reserved.fail(),
  };
}
