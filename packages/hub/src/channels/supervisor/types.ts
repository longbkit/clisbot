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
  SupportedChannelName,
} from "../plane/types.js";
import type { ChannelDaemonClientOptions } from "../daemon/client.js";
import type { ChannelAccessTicketTarget } from "../daemon/access-ticket.js";
import type { CompiledChannelAccount } from "../config/compile.js";
import type { QrLoginResult, QrLoginVerb } from "./qr-login.js";
import type { ChannelReplyCapabilityService } from "../channel-reply-capabilities.js";
import type { StagedChannelMedia } from "../media/outbound-stager.js";
import type { MessagePresentation } from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";

/** The per-account transport state the ops layer reports (`channels status`). */
export type ChannelTransportState =
  | "starting"
  | "started"
  | "deferred"
  | "stopped"
  | "failed"
  /** A QR-auth account whose profile has no live session. Terminal until an
   * operator completes the channel-accounts QR login; the supervisor does not
   * restart it on the same revision (`supervisor/needs-login.ts`). */
  | "needs-login"
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
  appWebUrl?: string;
  commandAccess?: import("../plane/types.js").ChannelPlaneDeps["commandAccess"];
  cancelWorkflowRuns?: import("../plane/types.js").ChannelPlaneDeps["cancelWorkflowRuns"];
  readWorkflowRuns?: import("../plane/types.js").ChannelPlaneDeps["readWorkflowRuns"];
  /** The runtime handle: `ChannelStore` (org-scoped channel runtime state). */
  databaseRuntime: DatabaseRuntime;
  /** Test seam; production resolves encrypted credentials through `database`. */
  resolveConnection?: Database["resolveChannelConnection"];
  /** The Hub data directory (`PASEO_HUB_DATA_DIR`): installs and state. */
  dataDir: string;
  /** Pass-through for `connectChannelDaemon` (loopback host/home or relay url). */
  daemon?: ChannelDaemonClientOptions;
  /** Build the per-account `resolveAccessTicket` that admits the account's
   * trusted-client socket into a managed-access `external` daemon (Phase 1,
   * docs/audits/2026-09-10). The composition root owns the access/ticket wiring;
   * the supervisor only supplies the account's daemon reference + stable
   * clientId. Absent (or the account has no daemon route) → no ticket, the
   * trusted session admits as today. */
  buildDaemonAccessTicketResolver?: (
    target: ChannelAccessTicketTarget,
  ) => () => Promise<string | undefined>;
  /** Resolve the ordered daemon socket candidates (direct then relay) for an
   * account's route daemon from that daemon's persisted `ConnectionOffer` — the
   * same offer any trusted client (app/web) reaches it by, so channels are
   * multi-daemon by construction. Returns `[]` when the daemon has no offer (or
   * managed access is unwired); the supervisor then falls back to the global
   * `daemon` option (env) or loopback discovery. */
  resolveDaemonTarget?: (target: {
    organizationId: string;
    daemonReference: string;
  }) => Promise<string[]>;
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
  channelReplyPost(
    ref: ChannelReplyBindingRef,
    text: string,
    options?: { presentation?: MessagePresentation | undefined },
  ): Promise<OutboundPostResult>;
  channelReplyMediaPost(
    ref: ChannelReplyBindingRef,
    file: StagedChannelMedia,
  ): Promise<MediaPostResult>;
  /** Optional read-only lookup through the currently configured Connection. */
  resolveConversation?(input: {
    organizationId: string;
    channel: SupportedChannelName;
    accountId: string;
    connectionId: string;
    conversationId: string;
    budget?: { remaining: number };
  }): Promise<ChannelConversationMetadata | null>;
  /** Sends the fixed management test message through one already-started account. */
  postTestMessage(input: {
    channel: SupportedChannelName;
    accountId: string;
    conversationId: string;
    threadId?: string | undefined;
    expectedRevisionId?: string | null | undefined;
  }): Promise<OutboundPostResult>;
  /**
   * Run one QR-login setup verb for a QR-auth account (`supervisor/qr-login.ts`).
   * The account is LOADED for this, not started: linking is what a start needs,
   * so it has to work before the transport can come up. Never returns session
   * material — only the code to scan and where the login stands.
   */
  qrLogin?(input: {
    organizationId: string;
    channel: SupportedChannelName;
    accountId: string;
    compiled: CompiledChannelAccount;
    verb: QrLoginVerb;
  }): Promise<QrLoginResult>;
  workflowStreamEvent?(input: {
    execution: AgentExecutionRecord;
    agentId: string;
    event: DaemonAgentStreamEvent;
  }): Promise<void>;
}
