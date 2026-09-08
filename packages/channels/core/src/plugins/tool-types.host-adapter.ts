// Fusion-owned host adapter for `src/plugins/tool-types.ts` (D-CORE-330).
//
// Upstream's module is the plugin host's tool contract: it pulls the agent
// session tree, auth-profile store, browser bridge, conversation recall, hook
// registry and the host-bound per-turn delivery handle. Fusion has no plugin
// host — the Hub owns tool authorization, routing and delivery — so the context
// is narrowed to the members the ported channel tool factories read, with
// upstream's field names and comments so a ported executor stays verbatim.
//
// Adding a member here means the Hub tool slice must supply it, so the list
// stays exactly what the ported executors use.
import type { AnyAgentTool } from "../agents/tools/common.host-adapter.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

/** Upstream `src/agents/tool-fs-policy.types.ts`, narrowed to the read field. */
export type ToolFsPolicy = { workspaceOnly: boolean };

/**
 * Upstream `src/channels/plugins/conversation-read-origin.ts`: the server-owned
 * origin of a conversation-read operation. Missing values are delegated.
 */
export type ConversationReadInvocationOrigin = "delegated" | "direct-operator";

/** Upstream `src/utils/delivery-context.types.ts`, narrowed to the route. */
export type DeliveryContext = {
  channel?: string;
  accountId?: string;
  to?: string;
  threadId?: string;
};

/** Trusted execution context passed to plugin-owned agent tool factories. */
export type OpenClawPluginToolContext = {
  config?: OpenClawConfig;
  /** Effective filesystem policy for the active tool run. */
  fsPolicy?: ToolFsPolicy;
  workspaceDir?: string;
  messageChannel?: string;
  agentAccountId?: string;
  /** Trusted ambient delivery route for the active agent/session. */
  deliveryContext?: DeliveryContext;
  /** Trusted platform-native conversation id for the active inbound turn. */
  nativeChannelId?: string;
  /** Trusted sender id from inbound context (runtime-provided, not tool args). */
  requesterSenderId?: string;
  /**
   * Server-owned origin for this operation. Missing values are delegated.
   * Plugins must use it only for conversation-read visibility policy.
   */
  conversationReadOrigin?: ConversationReadInvocationOrigin;
};

export type OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext,
) => AnyAgentTool | AnyAgentTool[] | null | undefined;

export type OpenClawPluginToolOptions = {
  name?: string;
  names?: string[];
  optional?: boolean;
};

/** Upstream `src/plugins/logger-types.ts`, unchanged. */
export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

/**
 * The slice of upstream's `OpenClawPluginApi` (`src/plugins/types.ts`, a
 * ~400-member host interface) that the ported `register*Tools` entry points
 * touch: the resolved config they gate registration on, a logger, and
 * `registerTool`. A vertical's `src/fusion/tools.ts` builds one of these per
 * account over a Fusion tool registrar.
 */
export type OpenClawPluginApi = {
  config: OpenClawConfig;
  logger: PluginLogger;
  registerTool: (
    tool: AnyAgentTool | OpenClawPluginToolFactory,
    opts?: OpenClawPluginToolOptions,
  ) => void;
};
