import type { ChannelConversationMetadata } from "@getpaseo/channels-shared";
// The channel supervisor's public surface (plan §4-S1 / implementation doc §4.3.9):
// the per-account lifecycle the control plane drives — install → load → start →
// drive, plus teardown. This file is the shared contract the control-plane ops
// handlers compile against; the implementation lives in this directory's
// `index.ts`. Loaded only under CLISBOT_HUB_CHANNELS_ENABLED (byte-equivalence).
//
// Failure isolation (P13): a channel fault — including an event-loop hang or a
// dead daemon — can take the account (or the Hub) down; it can never reach the
// daemon or any agent session. Every per-account step fails closed and is
// isolated: one account's failure never aborts the others.

import type { Database } from "../../db/types.js";
import type { AgentExecutionRecord } from "../../db/types.js";
import type { DaemonAgentStreamEvent } from "../../daemons/protocol.js";
import type { DatabaseRuntime } from "../../db/runtime/index.js";
import type {
  ChannelReplyBindingRef,
  MediaPostResult,
  OutboundPostResult,
  PlaneLogger,
  P0ChannelName,
} from "../plane/types.js";
import type { ChannelDaemonClientOptions } from "../daemon/client.js";
import type { ChannelReplyCapabilityService } from "../channel-reply-capabilities.js";

/** The per-account transport state the ops layer reports (`channels status`). */
export type ChannelTransportState =
  | "starting"
  | "started"
  | "deferred"
  | "stopped"
  | "failed"
  | "disabled";

/** One account's outcome of an install → start attempt. */
export interface ChannelAccountStartResult {
  channel: string;
  account: string;
  /** Fresh install vs a pin-matching install that was skipped. */
  installed: boolean;
  transport: "started" | "deferred";
  /** Why the transport was deferred, or the start failure (P13: logged, not thrown). */
  detail?: string;
}

/** One row of `GET /api/v1/channels/status` (the CLI's `ChannelStatusAccount`). */
export interface ChannelAccountStatusEntry {
  channel: string;
  account: string;
  /** The pinned main package `package@version` (absent when unknown). */
  pin?: string;
  integrity: "ok" | "failed" | "not-checked";
  loadTrace: "ok" | "failed" | "not-loaded";
  transport: ChannelTransportState;
  /** Why a deferred/failed transport is in that state (absent when started). */
  detail?: string;
}

/** The result of reconciling the running accounts to the active configuration. */
export interface ChannelReconcileResult {
  /** Accounts that changed and their start outcomes (newly enabled / restarted). */
  accounts: readonly ChannelAccountStartResult[];
  /** Accounts whose config disappeared and were stopped. */
  stopped: readonly { channel: string; account: string }[];
}

export interface ChannelSupervisorOptions {
  /** The `Database` facade: the active-configuration read path (control-plane.ts). */
  database: Database;
  /** Canonical Hub URL reachable by local and remote daemon Agents. */
  publicBaseUrl?: string;
  /** The runtime handle: `ChannelStore` (org-scoped channel runtime state). */
  databaseRuntime: DatabaseRuntime;
  /** Test seam; production resolves encrypted credentials through `database`. */
  resolveConnection?: Database["resolveChannelConnection"];
  /** The Hub data directory (`PASEO_HUB_DATA_DIR`): installs and state. */
  dataDir: string;
  /** Pass-through for `connectChannelDaemon` (loopback host/home or relay url). */
  daemon?: ChannelDaemonClientOptions;
  /** The channel-pins path; defaults to the packaged `channel-pins.json`. */
  pinsPath?: string;
  logger?: PlaneLogger;
  /** The process environment the channel gate + policy read; default `process.env`. */
  env?: NodeJS.ProcessEnv;
  dispatchWorkflow?: import("../plane/types.js").ChannelPlaneDeps["dispatchWorkflow"];
  authorizeChannelUse?: import("../plane/types.js").ChannelPlaneDeps["authorizeChannelUse"];
  authorizeChannelApproval?: import("../plane/types.js").ChannelPlaneDeps["authorizeChannelApproval"];
  consumeChannelIdentityChallenge?: import("../plane/types.js").ChannelPlaneDeps["consumeChannelIdentityChallenge"];
  /** Transfer one Slack app's Socket Mode consumer to this Channel account. */
  claimSlackInbound?: (
    providerApplicationId: string,
    owner: string,
  ) => Promise<() => Promise<void>>;
}

/**
 * The per-account lifecycle the control plane drives. All methods are
 * self-contained: they resolve the organization + active configuration
 * themselves (control-plane.ts) and never throw a channel fault outward —
 * per-account failures land in `detail` / the transport state.
 */
export interface ChannelSupervisor {
  /** Shared process-lifetime owner for direct and Automation reply capabilities. */
  readonly channelReplyCapabilities?: ChannelReplyCapabilityService;
  /** Mount-time recovery: install + start every enabled account (P13: isolated). */
  startAll(): Promise<void>;
  /** Teardown: stop every account's transport, plane, and daemon connection. */
  stopAll(): Promise<void>;
  /** One account's install → load → start (the `channels add` transport step). */
  startAccount(channel: string, accountId: string): Promise<ChannelAccountStartResult>;
  /** After a revision activates: reconcile running accounts to the new config. */
  reconcile(): Promise<ChannelReconcileResult>;
  /** Per-account pin / integrity / load-trace / transport (the status endpoint). */
  status(): readonly ChannelAccountStatusEntry[];
  /**
   * The tool-path post seam (E4): the account's outbound (the vertical's
   * `sendText` through `postFor`) addressed by the server-owned binding ref. The
   * channel-reply MCP endpoint writes its ledger row, then calls this.
   * Fail-closed for an unstarted/unknown account (`{ok: false}`) — the
   * endpoint maps that to a clean tool error.
   */
  channelReplyPost(ref: ChannelReplyBindingRef, text: string): Promise<OutboundPostResult>;
  channelReplyMediaPost(ref: ChannelReplyBindingRef, filePath: string): Promise<MediaPostResult>;
  /** Optional read-only lookup through the currently configured Connection. */
  resolveConversation?(input: {
    organizationId: string;
    channel: P0ChannelName;
    accountId: string;
    connectionId: string;
    conversationId: string;
    budget?: { remaining: number };
  }): Promise<ChannelConversationMetadata | null>;
  /** Sends the fixed management test message through one already-started account. */
  postTestMessage(input: {
    channel: P0ChannelName;
    accountId: string;
    conversationId: string;
    threadId?: string | undefined;
    expectedRevisionId?: string | null | undefined;
  }): Promise<OutboundPostResult>;
  workflowStreamEvent?(input: {
    execution: AgentExecutionRecord;
    agentId: string;
    event: DaemonAgentStreamEvent;
  }): Promise<void>;
}
