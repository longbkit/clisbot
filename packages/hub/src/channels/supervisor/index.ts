import { registerChannelDriveConfig } from "../message-actions.js";
import { createConversationMetadataResolver } from "../conversation-metadata.js";
import type { ChannelConversationMetadata } from "@getpaseo/channels-shared";
import { channelTestMessage } from "../test-message.js";
// The channel supervisor (plan §4-S1 / implementation doc §4.3.9): the
// coordinate/mount module that drives the per-account lifecycle —
// install → load → start → drive — plus teardown. One in-process vertical per
// account, one execution plane per vertical, one trusted-client daemon
// connection per account (a shared daemon connection would die with the first
// plane stop). The control-plane ops layer drives this through the
// `ChannelSupervisor` contract in `types.ts`.
//
// Hard-limit exception (file > 700 lines, 2026-08-27): pre-existing P0-wave
// breach (HEAD ~848 lines before the native approval-card slice); the slice
// (E1/E2/E3/E5) is additive only — `updateFor`, the `channelRuntime.approvalAction`
// mount, the subagent-frame path. The split decision is recorded in the
// 2026-08-24 implementation doc §4.6 notice 12.
//
// Failure isolation (P13): every per-account step fails closed. A channel
// fault — a dead daemon, a bad pin, a load-trace miss — marks the account
// `failed` and lands in the result's `detail`; it never throws out of the
// public API and never aborts a sibling account's start.
//
// Byte-equivalent off: when `isChannelsEnabled(env)` is false, every method is
// a safe no-op returning the deferred/empty shape — no pins read, no install
// dir touched, no vertical loaded, no daemon socket opened.

import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadChannelControlPlane, type ChannelControlPlaneSnapshot } from "../control-plane.js";
import type { CompiledChannelAccount } from "../config/compile.js";
import { ChannelStore } from "../../db/channels.js";
import { ChannelReplyCapabilityStore } from "../../db/channel-reply-capabilities.js";
import {
  connectChannelDaemon,
  type ChannelDaemonClientOptions,
  type DaemonConnection,
} from "../daemon/client.js";
import { createChannelPlane, type ChannelPlane } from "../execution.js";
import { awaitMonitorExit, MONITOR_STOP_GRACE_MS } from "./monitor-stop.js";
import {
  ensureChannelInstalled,
  InstallError,
  type ChannelInstallResult,
} from "../install/install-channel.js";
import { ProvisionError } from "../install/provision-main.js";
import { loadChannelPins, type ChannelPinEntry } from "../install/pins.js";
import { isChannelsEnabled } from "../loader/channel-gate.js";
import {
  createChannelIngressDrain,
  type ChannelIngressDeferral,
  type ChannelIngressDrain,
  type ChannelIngressDrainLog,
} from "../ingress/drain.js";
import { resolveHubIngressNonRetryableFailure } from "../ingress/non-retryable.js";
import {
  createChannelIngressRetentionSweep,
  type ChannelIngressRetentionSweep,
} from "../ingress/retention.js";
import { createChannelIngressQueueSink } from "../ingress/queue-sink.js";
import {
  createHostRuntime,
  type HostRuntime,
  type InboundLedgerSink,
  type InboundQueueSink,
  type InboundReplyParams,
  type InboundReplyResult,
  type StartAccountContext,
} from "../loader/host.js";
import { loadChannelVertical, type LoadedChannelVertical } from "../loader/load-channel.js";
import { runAsChannelAccount } from "../loader/hooks.js";
import { setChannelSeamLogger } from "../loader/seam-logger.js";
import { createStreamingDriver } from "../streaming/index.js";
import { isEnabled } from "../policy.js";
import { isSupportedChannel } from "../catalog.js";
import type { MessagePresentation } from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";
import { buildAccountCarriers } from "./account-carriers.js";
import type {
  ApprovalCallbackParams,
  ChannelReplyBindingRef,
  InboundMessage,
  MediaPostParams,
  MediaPostResult,
  OutboundPostResult,
  PlaneInboundResult,
  PlaneLogger,
  PostFn,
  SupportedChannelName,
  UpdateFn,
  TypingFn,
} from "../plane/types.js";
import { planeInboundDeferral } from "../plane/types.js";
import type { StagedChannelMedia } from "../media/outbound-stager.js";

/**
 * The account's native-media post, widened with the facts a staged `message`
 * attachment carries (slice 11b). Every extra field is optional, so this stays
 * assignable to the plane's `MediaPostFn` and the relay's one-file path is
 * unchanged.
 */
type ChannelMediaPostFn = (
  params: MediaPostParams & {
    fileName?: string | undefined;
    mimeType?: string | undefined;
    asVoice?: boolean | undefined;
  },
) => Promise<MediaPostResult>;
import { resolveHome } from "../daemon/discovery.js";
import {
  createHostKeyedStoreRoot,
  type HostKeyedStoreRoot,
  type KeyedStoreBackend,
} from "../state/keyed-store.js";
import { encryptedStateNamespaces } from "../state/encrypted-namespaces.js";
import { isSettledTransport, monitorFailureTransport } from "./needs-login.js";
import { runQrLoginVerb, type QrLoginResult, type QrLoginVerb } from "./qr-login.js";
import { openChannelSecretStateBackend } from "../state/secret-backend.js";
import { ChannelReplyCapabilityRegistry } from "../channel-reply-capabilities.js";
import type {
  ChannelAccountStartResult,
  ChannelAccountStatusEntry,
  ChannelReconcileResult,
  ChannelSupervisor,
  ChannelSupervisorOptions,
  ChannelTransportState,
} from "./types.js";

/** The inbound seam until the account's plane is wired (fail closed: no dispatch). */
type InboundReplyHandler = (params: InboundReplyParams) => Promise<InboundReplyResult>;

/**
 * The plane's inbound normalizer — the ONLY one (the pinned verticals expose no
 * entry normalizer). `ctxPayload` is the vertical's flat `FinalizedMsgContext`
 * (pinned-vertical-contracts/inbound.md): no nested `conversation`, no
 * `messageId` key, no `sender` object. It maps the native conversation shape
 * (Slack `direct`/`group`/`channel` + thread ts; Telegram `direct`/`group` +
 * topic id) onto the plane's route-match vocabulary via the pinned
 * native → plane table, and nulls non-plane events (empty text, missing
 * conversation, unknown kind, missing sender). The sender is normalized to
 * the plane's `<channel>:<provider-id>` identity (§4.3.2) — the ctxPayload
 * carries the raw native id.
 */
export function flatInboundNormalizer(params: InboundReplyParams): InboundMessage | null {
  const ctx = params.ctxPayload;
  const accountId = confirmedString(params.accountId) ?? confirmedString(ctx["AccountId"]);
  if (!isSupportedChannel(params.channel) || accountId === null) return null;
  const text = confirmedString(ctx["Body"]);
  if (text === null) return null;
  const chatType = confirmedString(ctx["ChatType"]);
  const chatId = confirmedString(ctx["ChatId"]);
  const conversation = planeConversation(params.channel, chatType, chatId, ctx["MessageThreadId"]);
  if (conversation === null) return null;
  // The plane's identity model is `<channel>:<provider-id>` (implementation doc
  // §4.3.2); the ctxPayload carries the raw native id, so the prefix is applied
  // here — the native → plane boundary — and nowhere else.
  const rawSenderId = confirmedString(ctx["SenderId"]) ?? confirmedString(ctx["From"]);
  if (rawSenderId === null) return null;
  const conversationLabel = confirmedString(ctx["ConversationLabel"]);
  const senderName = confirmedString(ctx["SenderName"]);
  // The marker's native message id (Slack `ts`): the only durable anchor the
  // relay can mint a new reply thread on when `reply.anchor` is `thread` and
  // the marker itself arrived at the conversation root.
  const messageSid = confirmedString(ctx["MessageSid"]);
  return {
    channel: params.channel,
    accountId,
    senderIdentity: `${params.channel}:${rawSenderId}`,
    ...(senderName !== null ? { senderName } : {}),
    text,
    mentionedBot: ctx["WasMentioned"] === true,
    conversation,
    ...(conversationLabel !== null ? { conversationLabel } : {}),
    ...(messageSid !== null ? { externalMessageId: messageSid } : {}),
  };
}

/** The native → plane mapping for one (channel, native kind, thread id) triple. */
function planeConversation(
  channel: string,
  chatType: string | null,
  chatId: string | null,
  messageThreadId: unknown,
): InboundMessage["conversation"] | null {
  if (chatType === null || chatId === null) return null;
  const threadId = threadIdOf(messageThreadId);
  const planeKind = planeKindFor(channel, chatType, threadId);
  if (planeKind === null) return null;
  if (threadId !== null) {
    // A thread/topic is its own conversation; the root keeps the native kind.
    return {
      kind: planeKind,
      id: threadId,
      rootConversationId: chatId,
      threadId,
    };
  }
  return {
    kind: planeKind,
    id: chatId,
    rootConversationId: chatId,
    threadId: null,
  };
}

/** The pinned payload's `MessageThreadId` is a string or a number; anything
 * else is a root-level message. */
function threadIdOf(messageThreadId: unknown): string | null {
  if (typeof messageThreadId === "string") return messageThreadId;
  if (typeof messageThreadId === "number") return String(messageThreadId);
  return null;
}

/** The plane `kind` a native conversation maps to (null = not plane-bound). */
function planeKindFor(
  channel: string,
  chatType: string,
  threadId: string | null,
): InboundMessage["conversation"]["kind"] | null {
  if (channel === "slack") {
    if (chatType === "direct") return "dm";
    if (chatType === "group") return "group";
    if (chatType === "channel") return threadId !== null ? "thread" : "channel";
    return null;
  }
  if (channel === "telegram") {
    if (chatType === "direct") return "dm";
    if (chatType === "group") return threadId !== null ? "topic" : "group";
    return null;
  }
  // A Discord thread IS a channel (the thread id is the channel the message
  // arrived in), so the guild mapping matches Slack's; the vertical emits only
  // `direct` and `channel` (transport/gateway.ts `resolveChatType`).
  if (channel === "discord") {
    if (chatType === "direct") return "dm";
    if (chatType === "channel") return threadId !== null ? "thread" : "channel";
    return null;
  }
  return null;
}

/**
 * The plane's post path: the loaded plugin's own outbound (`outbound.md`). Both
 * pinned verticals expose `plugin.outbound.sendText({cfg, to, text,
 * accountId, threadId})`; both THROW on failure. Fail closed: a missing
 * `sendText` or a throw lands as `{ok: false, error}` — never a fake success.
 */
function postFor(
  handle: AccountHandle,
  cfg: Record<string, unknown>,
  hostRuntime: HostRuntime,
  logger: PlaneLogger,
): PostFn {
  const send = handle.vertical?.plugin?.outbound?.["sendText"];
  if (typeof send !== "function") {
    return async () => ({
      ok: false,
      error: "the loaded channel plugin exposes no outbound.sendText",
    });
  }
  return async (params) => {
    try {
      const result = await (
        send as (args: Record<string, unknown>) => Promise<{
          messageId?: unknown;
          cardPosted?: unknown;
        }>
      )({
        cfg,
        hostRuntime,
        to: params.to,
        text: params.text,
        accountId: handle.accountId,
        ...(params.threadId !== undefined ? { threadId: params.threadId } : {}),
        // COMPAT(clisbot-control-plane): the native card payload (the approval
        // card's `blocks` / `reply_markup`) — posted with the text (the text
        // stays the fallback rendering on both verticals).
        ...(params.blocks !== undefined ? { blocks: params.blocks } : {}),
        ...(params.replyMarkup !== undefined ? { replyMarkup: params.replyMarkup } : {}),
        // The portable presentation, for a vertical that compiles it into
        // native blocks (Slack's `sendSlackText`). The Hub only passes one to a
        // vertical that declares it renders them
        // (`readPluginPresentationOutbound`), so a vertical that ignores the arg
        // is never handed a message whose content lives only in the blocks.
        ...(params.presentation !== undefined ? { presentation: params.presentation } : {}),
        // Telegram only: disable the native config write-back (admin-scope
        // check fails) — P0 posts numeric chat ids, no legacy rewrite (outbound.md).
        ...(handle.channel === "telegram" ? { gatewayClientScopes: [] } : {}),
      });
      if (typeof result.messageId !== "string" && typeof result.messageId !== "number") {
        throw new Error("channel outbound.sendText returned no messageId");
      }
      return {
        ok: true,
        externalMessageId: String(result.messageId),
        ...(result.cardPosted !== undefined ? { cardPosted: result.cardPosted === true } : {}),
      };
    } catch (error) {
      logger.warn("channel post failed", {
        channel: handle.channel,
        account: handle.accountId,
        to: params.to,
        error: errorMessage(error),
      });
      return { ok: false, error: errorMessage(error) };
    }
  };
}

/**
 * COMPAT(clisbot-control-plane): the plane's native-media post path (group G,
 * G7–G11) — the loaded plugin's optional `outbound.sendMedia`, driven by the
 * relay's final-answer path when an agent's reply references a local media
 * file. Fail closed: a missing `sendMedia` returns `undefined` — the relay's
 * media path is then a no-op (byte-identical text relay). `mediaPosted` is
 * the vertical's G11 contract: false when the vertical refused the file and
 * posted the in-channel notice through its text path (either way a channel
 * message was posted, so the relay confirms the row on that message's id and
 * never re-posts). A transport fault (the vertical throws: missing file,
 * API failure) lands as `{ok: false, error}` — the relay's failDelivery owns
 * it.
 */
function mediaPostFor(
  handle: AccountHandle,
  cfg: Record<string, unknown>,
  hostRuntime: HostRuntime,
  logger: PlaneLogger,
): ChannelMediaPostFn | undefined {
  const send = handle.vertical?.plugin?.outbound?.["sendMedia"];
  if (typeof send !== "function") return undefined;
  return async (params) => {
    try {
      const result = await (
        send as (args: Record<string, unknown>) => Promise<{
          messageId?: unknown;
          mediaPosted?: unknown;
        }>
      )({
        cfg,
        hostRuntime,
        to: params.to,
        filePath: params.filePath,
        accountId: handle.accountId,
        ...(params.threadId !== undefined ? { threadId: params.threadId } : {}),
        // The staged facts a `message` attachment carries. The relay's one-file
        // path leaves them undefined and the vertical falls back to the path,
        // as before; a `message` send names the file the model asked for and
        // can ask Telegram for a voice note.
        ...(params.fileName === undefined ? {} : { fileName: params.fileName }),
        ...(params.mimeType === undefined ? {} : { mimeType: params.mimeType }),
        ...(params.asVoice === undefined ? {} : { asVoice: params.asVoice }),
      });
      if (typeof result.messageId !== "string" && typeof result.messageId !== "number") {
        throw new Error("channel outbound.sendMedia returned no messageId");
      }
      return {
        ok: true,
        externalMessageId: String(result.messageId),
        // The G11 flag rides through only when the vertical reports it (the
        // shared SendMediaFn always does; an unknown flag is not asserted).
        ...(typeof result.mediaPosted === "boolean" ? { mediaPosted: result.mediaPosted } : {}),
      };
    } catch (error) {
      logger.warn("channel media post failed", {
        channel: handle.channel,
        account: handle.accountId,
        to: params.to,
        error: errorMessage(error),
      });
      return { ok: false, error: errorMessage(error) };
    }
  };
}

/**
 * COMPAT(clisbot-control-plane): the plane's in-place update path — the
 * loaded plugin's optional `outbound.updateText` (Slack `chat.updateMessage`,
 * Telegram `editMessageText`). The approval engine's card decides against it
 * ("Approved by <sender>" / "Denied" / "Answered: <option>"). A missing
 * `updateText` or a throw lands as `{ok: false}` — never a fake success, and
 * never affecting the resolution (the daemon frame is already dispatched).
 */
function updateFor(
  handle: AccountHandle,
  cfg: Record<string, unknown>,
  hostRuntime: HostRuntime,
  logger: PlaneLogger,
): UpdateFn {
  const update = handle.vertical?.plugin?.outbound?.["updateText"];
  if (typeof update !== "function") {
    return async () => ({
      ok: false,
      error: "the loaded channel plugin exposes no outbound.updateText",
    });
  }
  return async (params) => {
    try {
      const result = await (update as (args: Record<string, unknown>) => Promise<unknown>)({
        cfg,
        hostRuntime,
        accountId: handle.accountId,
        ...(params.senderMention !== undefined ? { senderMention: params.senderMention } : {}),
        to: params.to,
        externalMessageId: params.externalMessageId,
        text: params.text,
        ...(params.threadId !== undefined ? { threadId: params.threadId } : {}),
        ...(params.clearCard !== undefined ? { clearCard: params.clearCard } : {}),
        ...(handle.channel === "telegram" ? { gatewayClientScopes: [] } : {}),
      });
      if (typeof result === "object" && result !== null && Reflect.get(result, "ok") === false) {
        throw new Error("channel outbound.updateText reported failure");
      }
      return { ok: true };
    } catch (error) {
      logger.warn("channel in-place update failed", {
        channel: handle.channel,
        account: handle.accountId,
        to: params.to,
        error: errorMessage(error),
      });
      return { ok: false, error: errorMessage(error) };
    }
  };
}

/**
 * COMPAT(clisbot-control-plane): the plane's liveness path — the loaded
 * plugin's optional `outbound.typing` (Slack's assistant thread status +
 * inbound reaction, Telegram's `sendChatAction`). Undefined when the plugin
 * exposes none, which leaves the seam unmounted (no timers, no warnings — an
 * absent capability is not an error). A wire fault THROWS to the controller,
 * which counts it and trips its breaker: typing can never disturb the reply
 * path.
 */
function typingFor(
  handle: AccountHandle,
  cfg: Record<string, unknown>,
  hostRuntime: HostRuntime,
): TypingFn | undefined {
  const drive = handle.vertical?.plugin?.outbound?.["typing"];
  if (typeof drive !== "function") return undefined;
  return async (params) => {
    await (drive as (args: Record<string, unknown>) => Promise<unknown>)({
      cfg,
      hostRuntime,
      accountId: handle.accountId,
      to: params.to,
      action: params.action,
      indicator: params.indicator,
      ...(params.threadId !== undefined ? { threadId: params.threadId } : {}),
      ...(params.messageId !== undefined ? { messageId: params.messageId } : {}),
      ...(params.reactionEmoji !== undefined ? { reactionEmoji: params.reactionEmoji } : {}),
      ...(handle.channel === "telegram" ? { gatewayClientScopes: [] } : {}),
    });
  };
}

/**
 * The drive-time account context (start-account.md): the flat token carrier
 * (`ctx.account`) + the `cfg` the vertical's outbound + account resolution
 * read tokens from. Tokens come from the encrypted provider connection selected
 * by `compiled.connectionId` — never process env. `cfg.channels.<ch>
 * .accounts` holds EXACTLY ONE entry (every vertical's duplicate-token guard
 * throws on a second account carrying the same token).
 */
async function accountAndCfg(
  resolveConnection: import("../../db/types.js").Database["resolveChannelConnection"],
  organizationId: string,
  compiled: CompiledChannelAccount,
  accountId: string,
): Promise<{
  account: Record<string, unknown>;
  cfg: Record<string, unknown>;
  providerApplicationId?: string;
}> {
  const channel = supportedChannel(compiled.channel);
  const credentials = await resolveConnection({
    organizationId,
    channel,
    connectionId: compiled.connectionId,
  });
  if (credentials === undefined) throw new Error("the channel connection is unavailable");
  // Every credential field the Connection carries, not just the two token ones:
  // the Feishu, Google Chat and Zalo Personal builders read their own names off
  // this carrier (`account-carriers.ts`).
  const { providerApplicationId } = credentials;
  const { account, cfgAccount } = buildAccountCarriers(channel, {
    ...credentials,
    accountId,
    compiled,
  });
  return {
    account,
    cfg: { channels: { [channel]: { accounts: { [accountId]: cfgAccount } } } },
    ...(providerApplicationId === undefined ? {} : { providerApplicationId }),
  };
}

/** The compiled account's channel as a supported name. The compiler rejects any
 * other channel (`compile-support.ts`), so reaching this with one is a bug —
 * fail the account loudly instead of silently driving it as another channel. */
function supportedChannel(channel: string): SupportedChannelName {
  if (!isSupportedChannel(channel)) {
    throw new Error(`channel ${channel} has no in-repo vertical`);
  }
  return channel;
}

interface AccountHandle {
  channel: string;
  accountId: string;
  organizationId?: string;
  revisionId: string | null;
  connectionId?: string;
  resolveConversation?: (
    to: string,
    budget?: { remaining: number },
  ) => Promise<ChannelConversationMetadata | null>;
  abortController: AbortController;
  plane?: ChannelPlane;
  daemon?: DaemonConnection;
  vertical?: LoadedChannelVertical;
  install?: ChannelInstallResult;
  pin?: string;
  transport: ChannelTransportState;
  integrity: "ok" | "failed" | "not-checked";
  loadTrace: "ok" | "failed" | "not-loaded";
  /** The last start attempt's outcome detail (why a deferred/failed account
   * is in that state) — surfaced on `channels status`. */
  detail?: string;
  /** The account's outbound post (the plugin's `sendText`), built with the
   * plane and kept for the tool-path MCP endpoint (`channelReplyPost`). */
  post?: PostFn;
  media?: ChannelMediaPostFn | undefined;
  releaseSlackInbound?: (() => Promise<void>) | undefined;
  /** Observed gateway lifetime; teardown waits for it so a replacement never
   * overlaps the old account's socket/poll handlers. */
  monitor?: Promise<void> | undefined;
}

/** The load step's bundle: the vertical, its host runtime, and the inbound wire. */
interface LoadedVerticalBundle {
  vertical: LoadedChannelVertical;
  hostRuntime: HostRuntime;
  /** Point the host runtime's inbound seam at the account's plane (post-load). */
  wireInbound(handler: InboundReplyHandler): void;
}

const NO_OP_LOGGER: PlaneLogger = { warn: () => undefined };

function handleKey(channel: string, accountId: string): string {
  return `${channel}:${accountId}`;
}

/** The daemon reference this account's agent routes target — the account's
 * single loopback daemon in Phase 1 (docs/audits/2026-09-10). Used to mint the
 * account's admission ticket under the right daemonId. Undefined for a
 * workflow-only account (no daemon session to admit); a mis-specified
 * environment is skipped (fail-closed), never thrown. */
function accountDaemonReference(
  account: CompiledChannelAccount,
  resolveTarget: ChannelControlPlaneSnapshot["resolveAgentAccessTarget"],
): string | undefined {
  const targets = [...account.routes.map((route) => route.target), account.fallback.target];
  for (const target of targets) {
    if (target?.kind !== "agent") continue;
    try {
      return resolveTarget(target).daemonReference;
    } catch {
      // A non-daemon / mis-specified environment is not admissible; try the next.
    }
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A confirmed string field, or null (the conservative normalizer's read). */
function confirmedString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

class ChannelSupervisorImpl implements ChannelSupervisor {
  readonly channelReplyCapabilities: ChannelReplyCapabilityRegistry;
  private readonly options: ChannelSupervisorOptions;
  private readonly env: NodeJS.ProcessEnv;
  private readonly logger: PlaneLogger;
  private readonly store: ChannelStore;
  private readonly pinsPath: string;
  private readonly handles = new Map<string, AccountHandle>();
  /** One durable ingress drain per started account, keyed like `handles`. */
  private readonly drains = new Map<string, ChannelIngressDrain>();
  /** Verticals loaded for a QR login on an account that is not started, keyed
   * like `handles`. Disposed when that account starts or the Hub stops. */
  private readonly setupSessions = new Map<string, LoadedChannelVertical>();
  /** Each loaded account's keyed-store root, keyed like `handles`; the QR link
   * path awaits its `flush` before answering (`rememberAccountState`). */
  private readonly accountState = new Map<string, HostKeyedStoreRoot>();
  /** Hub-wide retention for the durable queue; one timer, every organization. */
  private readonly retentionSweep: ChannelIngressRetentionSweep;

  constructor(options: ChannelSupervisorOptions) {
    this.options = options;
    this.env = options.env ?? process.env;
    this.logger = options.logger ?? NO_OP_LOGGER;
    this.store = new ChannelStore(options.databaseRuntime);
    this.channelReplyCapabilities = new ChannelReplyCapabilityRegistry({
      store: new ChannelReplyCapabilityStore(options.databaseRuntime),
      logger: this.logger,
    });
    this.retentionSweep = createChannelIngressRetentionSweep({
      store: this.store,
      log: {
        swept: (detail) => this.logger.info?.("channel ingress queue pruned", detail),
        faulted: (error) =>
          this.logger.warn("channel ingress retention sweep failed", {
            error: errorMessage(error),
          }),
      },
    });
    this.pinsPath =
      options.pinsPath ?? fileURLToPath(new URL("../../../channel-pins.json", import.meta.url));
    // The bound seam module (a separate compilation, drive-time) reports its
    // no-runtime miss through this sink; without it the miss is a silent
    // no-dispatch the operator cannot see (seam-logger.ts).
    setChannelSeamLogger(this.logger);
  }

  async startAll(): Promise<void> {
    if (!this.enabled()) return;
    // Retention is queue state, not account state: it runs even when no
    // account starts, so a decommissioned account's rows still age out.
    this.retentionSweep.start();
    // Agents outlive the Hub process: adopt the reply capabilities the daemon
    // still holds MCP URLs for before any of them is steered (D-W4-01).
    try {
      await this.channelReplyCapabilities.hydrate();
    } catch (error) {
      this.logger.warn("channel reply capabilities could not be restored", {
        error: errorMessage(error),
      });
    }
    let snapshot: ChannelControlPlaneSnapshot;
    try {
      snapshot = await loadChannelControlPlane(
        this.options.database,
        undefined,
        this.options.publicBaseUrl,
      );
    } catch (error) {
      // Mount-time recovery degrades: a missing org/configuration is operator
      // state, not a channel fault (P13: log, never throw).
      this.logger.warn("channel startAll skipped: the active configuration is unavailable", {
        error: errorMessage(error),
      });
      return;
    }
    for (const account of snapshot.controlPlane.accounts) {
      // P13: one account's failure never aborts the others — `startAccount`
      // fails closed and isolates every per-account step.
      await this.startAccount(account.channel, account.accountId);
    }
  }

  async startAccount(channel: string, accountId: string): Promise<ChannelAccountStartResult> {
    if (!this.enabled()) {
      return {
        channel,
        account: accountId,
        installed: false,
        transport: "deferred",
        detail: "the channel control plane is disabled",
      };
    }
    // A fresh attempt replaces any prior one (retry after a failure, restart).
    await this.teardown(this.handles.get(handleKey(channel, accountId)));
    const handle = this.createHandle(channel, accountId);
    try {
      // Resolve on demand: re-read the active revision, no caching.
      const snapshot = await loadChannelControlPlane(
        this.options.database,
        undefined,
        this.options.publicBaseUrl,
      );
      handle.organizationId = snapshot.organizationId;
      const compiled = snapshot.controlPlane.accounts.find(
        (candidate) => candidate.channel === channel && candidate.accountId === accountId,
      );
      if (compiled === undefined) {
        return this.defer(
          handle,
          `the account "${accountId}" is not in the active ${channel} configuration`,
        );
      }
      if (!isEnabled(this.enabled(), snapshot.controlPlane, compiled)) {
        return this.defer(handle, "channels are disabled in the active configuration");
      }
      const pins = loadChannelPins(this.pinsPath);
      const pinEntry = pins.channels[channel];
      if (pinEntry === undefined) {
        throw new InstallError(`unknown channel: ${channel}`, { channel });
      }
      // A QR login may have loaded this vertical already; the account's own
      // start takes the load over, so release the setup-only one first.
      this.disposeSetupSession(channel, accountId);
      const install = await ensureChannelInstalled(pins, channel, accountId, this.options.dataDir);
      handle.install = install;
      handle.integrity = "ok";
      handle.pin = `${pins.main.package}@${pins.main.version}`;
      // Both steps run as this account (loader/hooks.ts): a vertical finishes
      // importing its SDK after `startAccount` resolves, and `startAll` starts
      // the next account meanwhile — the scope is what keeps those late modules
      // out of the neighbour's load trace.
      const loaded = await runAsChannelAccount(channel, accountId, () =>
        this.loadVertical(channel, accountId, install, pinEntry, snapshot.organizationId),
      );
      handle.vertical = loaded.vertical;
      handle.loadTrace = "ok";
      await runAsChannelAccount(channel, accountId, () =>
        this.startTransport(handle, snapshot, compiled, loaded),
      );
      handle.revisionId = snapshot.revision?.id ?? null;
      handle.transport = "started";
      delete handle.detail;
      return {
        channel,
        account: accountId,
        installed: install.installed,
        transport: "started",
      };
    } catch (error) {
      // P13: the failure is logged + surfaced in the result, never thrown.
      const detail = errorMessage(error);
      handle.detail = detail;
      this.logger.warn("channel account start failed", {
        channel,
        account: accountId,
        detail,
      });
      await this.stopHandle(handle, { cancelActive: true });
      handle.transport = "failed";
      if (error instanceof InstallError || error instanceof ProvisionError)
        handle.integrity = "failed";
      if (handle.integrity === "ok" && handle.loadTrace === "not-loaded")
        handle.loadTrace = "failed";
      return {
        channel,
        account: accountId,
        installed: handle.install?.installed ?? false,
        transport: "deferred",
        detail,
      };
    }
  }

  async reconcile(): Promise<ChannelReconcileResult> {
    const empty: ChannelReconcileResult = { accounts: [], stopped: [] };
    if (!this.enabled()) return empty;
    let snapshot: ChannelControlPlaneSnapshot;
    try {
      snapshot = await loadChannelControlPlane(
        this.options.database,
        undefined,
        this.options.publicBaseUrl,
      );
    } catch (error) {
      this.logger.warn("channel reconcile skipped: the active configuration is unavailable", {
        error: errorMessage(error),
      });
      return empty;
    }
    const desired = new Set(
      snapshot.controlPlane.accounts
        .filter((account) => isEnabled(this.enabled(), snapshot.controlPlane, account))
        .map((account) => handleKey(account.channel, account.accountId)),
    );
    // Configured at all, enabled or not: a DISABLED account keeps its stored
    // credentials, a REMOVED one must not (a QR session outliving its account
    // is a live impersonation credential nobody owns any more).
    const configured = new Set(
      snapshot.controlPlane.accounts.map((account) =>
        handleKey(account.channel, account.accountId),
      ),
    );
    const stopped: { channel: string; account: string }[] = [];
    // A Map iterator tolerates deleting the entry it is on; no snapshot needed.
    for (const [key, handle] of this.handles) {
      if (desired.has(key)) continue;
      this.handles.delete(key);
      this.disposeSetupSession(handle.channel, handle.accountId);
      await this.stopHandle(handle, { cancelActive: true, retireCapabilities: true });
      if (!configured.has(key)) await this.forgetAccountSecrets(handle);
      stopped.push({ channel: handle.channel, account: handle.accountId });
    }
    const accounts: ChannelAccountStartResult[] = [];
    for (const account of snapshot.controlPlane.accounts) {
      const key = handleKey(account.channel, account.accountId);
      const handle = this.handles.get(key);
      const activeRevisionId = snapshot.revision?.id ?? null;
      // An account already running this revision needs nothing. Neither does one
      // parked in `needs-login`: restarting it just re-runs the same failed
      // session probe, and the only thing that clears it is a human QR scan (a
      // new revision, or the QR login's own restart, does re-drive it).
      if (
        !desired.has(key) ||
        (handle !== undefined &&
          isSettledTransport(handle.transport) &&
          handle.revisionId === activeRevisionId)
      ) {
        continue;
      }
      accounts.push(await this.startAccount(account.channel, account.accountId));
    }
    return { accounts, stopped };
  }

  status(): readonly ChannelAccountStatusEntry[] {
    const entries: ChannelAccountStatusEntry[] = [];
    for (const handle of this.handles.values()) {
      const entry: ChannelAccountStatusEntry = {
        channel: handle.channel,
        account: handle.accountId,
        integrity: handle.integrity,
        loadTrace: handle.loadTrace,
        transport: handle.transport,
      };
      // `pin` is absent (not null/undefined) until the install step confirms it.
      if (handle.pin !== undefined) entry.pin = handle.pin;
      // `detail` explains a deferred/failed transport; absent when started.
      if (handle.detail !== undefined) entry.detail = handle.detail;
      entries.push(entry);
    }
    return entries;
  }

  async stopAll(): Promise<void> {
    if (!this.enabled()) return;
    await this.retentionSweep.stop();
    for (const [key, session] of this.setupSessions) {
      this.setupSessions.delete(key);
      session.dispose();
    }
    const handles = [...this.handles.values()];
    this.handles.clear();
    for (const handle of handles) await this.stopHandle(handle);
  }

  /**
   * The tool-path MCP endpoint's post seam (E4): use the capability's
   * server-owned binding ref to address a started account's outbound (`postFor`).
   * Fail-closed: an unstarted, unknown, or ref-less account returns
   * `{ok: false, error}` — the endpoint maps that to a clean tool error and
   * records a failed delivery. This is the SAME `sendText` seam the relay's
   * post path uses, so a tool-path post and a relay post land identically.
   */
  async channelReplyPost(
    ref: ChannelReplyBindingRef,
    text: string,
    options?: { presentation?: MessagePresentation | undefined },
  ): Promise<OutboundPostResult> {
    const handle = this.handles.get(handleKey(ref.channel, ref.accountId));
    const post = handle?.post;
    if (handle === undefined || post === undefined || handle.transport !== "started") {
      return {
        ok: false,
        error: `the ${ref.channel} account ${ref.accountId} is not started`,
      };
    }
    return post({
      channel: ref.channel,
      accountId: ref.accountId,
      to: ref.externalConversationId,
      ...(ref.externalThreadId !== null ? { threadId: ref.externalThreadId } : {}),
      text,
      ...(options?.presentation === undefined ? {} : { presentation: options.presentation }),
    });
  }

  async channelReplyMediaPost(
    ref: ChannelReplyBindingRef,
    file: StagedChannelMedia,
  ): Promise<MediaPostResult> {
    const handle = this.handles.get(handleKey(ref.channel, ref.accountId));
    const media = handle?.media;
    if (handle === undefined || media === undefined || handle.transport !== "started") {
      return {
        ok: false,
        error: `the ${ref.channel} account ${ref.accountId} is not started`,
      };
    }
    return media({
      channel: ref.channel,
      accountId: ref.accountId,
      to: ref.externalConversationId,
      ...(ref.externalThreadId !== null ? { threadId: ref.externalThreadId } : {}),
      filePath: file.filePath,
      fileName: file.fileName,
      ...(file.mimeType === undefined ? {} : { mimeType: file.mimeType }),
      ...(file.asVoice === undefined ? {} : { asVoice: file.asVoice }),
    });
  }

  async resolveConversation(input: {
    organizationId: string;
    channel: SupportedChannelName;
    accountId: string;
    connectionId: string;
    conversationId: string;
    budget?: { remaining: number };
  }): Promise<ChannelConversationMetadata | null> {
    const key = handleKey(input.channel, input.accountId);
    const handle = this.handles.get(key);
    if (
      handle?.transport !== "started" ||
      handle.organizationId !== input.organizationId ||
      handle.connectionId !== input.connectionId ||
      handle.resolveConversation === undefined
    )
      return null;
    const result = await handle.resolveConversation(input.conversationId, input.budget);
    return this.handles.get(key) === handle && !handle.abortController.signal.aborted
      ? result
      : null;
  }

  async postTestMessage(input: {
    channel: SupportedChannelName;
    accountId: string;
    conversationId: string;
    threadId?: string | undefined;
    expectedRevisionId?: string | null | undefined;
  }): Promise<OutboundPostResult> {
    const handle = this.handles.get(handleKey(input.channel, input.accountId));
    const post = handle?.post;
    if (handle === undefined || post === undefined || handle.transport !== "started") {
      return {
        ok: false,
        error: `the ${input.channel} account ${input.accountId} is not started`,
      };
    }
    if (input.expectedRevisionId !== undefined && handle.revisionId !== input.expectedRevisionId) {
      return {
        ok: false,
        error:
          "The Channel runtime has not applied this configuration. Refresh status and preview again.",
      };
    }
    const preview = channelTestMessage(input);
    return post({
      channel: input.channel,
      accountId: input.accountId,
      to: input.conversationId,
      ...(preview.threadId === null ? {} : { threadId: preview.threadId }),
      text: preview.text,
    });
  }

  /**
   * One QR-login verb for a QR-auth account. The vertical is LOADED (installed
   * + imported + its host runtime injected, including the encrypted state
   * backing) but not started: linking has to work before a start can succeed.
   * A started or `needs-login` account reuses its live load; anything else gets
   * a setup session that later start disposes.
   */
  async qrLogin(input: {
    organizationId: string;
    channel: SupportedChannelName;
    accountId: string;
    compiled: CompiledChannelAccount;
    verb: QrLoginVerb;
  }): Promise<QrLoginResult> {
    const vertical = await this.setupVertical(input.channel, input.accountId, input.organizationId);
    const resolveConnection =
      this.options.resolveConnection ??
      this.options.database.resolveChannelConnection.bind(this.options.database);
    const credentials = await resolveConnection({
      organizationId: input.organizationId,
      channel: input.channel,
      connectionId: input.compiled.connectionId,
    });
    const { account } = buildAccountCarriers(input.channel, {
      ...credentials,
      accountId: input.accountId,
      compiled: input.compiled,
    });
    const profile = typeof account["profile"] === "string" ? account["profile"] : input.accountId;
    const state = this.accountState.get(handleKey(input.channel, input.accountId));
    return runQrLoginVerb({
      plugin: vertical.plugin,
      accountId: input.accountId,
      profile,
      verb: input.verb,
      ...(state === undefined ? {} : { flushState: () => state.flush() }),
    });
  }

  /**
   * The loaded vertical a setup verb runs against. A started account (and an
   * account parked in `needs-login`, whose load survived its failed transport)
   * already has one; otherwise install + load it once and keep it for the next
   * verb in the same login.
   */
  private async setupVertical(
    channel: SupportedChannelName,
    accountId: string,
    organizationId: string,
  ): Promise<LoadedChannelVertical> {
    const key = handleKey(channel, accountId);
    const handle = this.handles.get(key);
    if (
      handle?.vertical !== undefined &&
      (handle.transport === "started" || handle.transport === "needs-login")
    ) {
      return handle.vertical;
    }
    const existing = this.setupSessions.get(key);
    if (existing !== undefined) return existing;
    const pins = loadChannelPins(this.pinsPath);
    const pinEntry = pins.channels[channel];
    if (pinEntry === undefined) throw new InstallError(`unknown channel: ${channel}`, { channel });
    const install = await ensureChannelInstalled(pins, channel, accountId, this.options.dataDir);
    const loaded = await this.loadVertical(channel, accountId, install, pinEntry, organizationId);
    this.setupSessions.set(key, loaded.vertical);
    return loaded.vertical;
  }

  /** Release a setup-only load. The account's own start owns the vertical from
   * then on; two live loads of one account would fight over the vertical's
   * module-level session store. */
  private disposeSetupSession(channel: string, accountId: string): void {
    const key = handleKey(channel, accountId);
    const session = this.setupSessions.get(key);
    if (session === undefined) return;
    this.setupSessions.delete(key);
    session.dispose();
  }

  async workflowStreamEvent(input: {
    execution: import("../../db/types.js").AgentExecutionRecord;
    agentId: string;
    event: import("../../daemons/protocol.js").DaemonAgentStreamEvent;
  }): Promise<void> {
    const context = input.execution.outputContext;
    if (typeof context !== "object" || context === null) return;
    const channel = Reflect.get(context, "channel");
    if (typeof channel !== "object" || channel === null) return;
    const name = Reflect.get(channel, "name");
    const accountId = Reflect.get(channel, "account_id");
    if (typeof name !== "string" || typeof accountId !== "string") return;
    const handle = this.handles.get(handleKey(name, accountId));
    await handle?.plane?.onWorkflowStreamEvent(input);
  }

  // --- Per-account lifecycle steps -------------------------------------------

  private enabled(): boolean {
    return isChannelsEnabled(this.env);
  }

  private createHandle(channel: string, accountId: string): AccountHandle {
    const handle: AccountHandle = {
      channel,
      accountId,
      revisionId: null,
      abortController: new AbortController(),
      transport: "starting",
      integrity: "not-checked",
      loadTrace: "not-loaded",
    };
    this.handles.set(handleKey(channel, accountId), handle);
    return handle;
  }

  private defer(handle: AccountHandle, detail: string): ChannelAccountStartResult {
    handle.transport = "deferred";
    handle.detail = detail;
    return {
      channel: handle.channel,
      account: handle.accountId,
      installed: false,
      transport: "deferred",
      detail,
    };
  }

  /**
   * Load the vertical in-process. The plane (the inbound's target) is built
   * only AFTER the load — its normalizer + post come from the entry — so the
   * host runtime starts with a fail-closed seam and `wireInbound` points it at
   * the plane once that exists.
   */
  private async loadVertical(
    channel: string,
    accountId: string,
    install: ChannelInstallResult,
    pinEntry: ChannelPinEntry,
    organizationId: string,
  ): Promise<LoadedVerticalBundle> {
    let inbound: InboundReplyHandler = async () => ({ dispatched: false });
    const hostRuntime = createHostRuntime({
      onInboundReply: (params) => inbound(params),
      // The account's stable on-disk state dir: poll offsets + dedupe caches
      // survive a Hub restart (state/keyed-store.ts). The namespaces holding
      // credential material go to the encrypted database backing instead
      // (state/encrypted-namespaces.ts).
      state: this.rememberAccountState(
        channel,
        accountId,
        createHostKeyedStoreRoot({
          dir: await this.adoptLegacyAccountDir({ organizationId, channel, accountId }, "state"),
          ...(await this.secretState(channel, accountId, organizationId)),
        }),
      ),
      // The vertical's structured log, routed into the Hub log tagged with the
      // account (host.ts's default is silent on every level; without this the
      // vertical's `ctx.log?.info(...)` lines vanish from hub.log).
      childLogger: (options) => {
        const tags = { channel, account: accountId, ...options };
        const metaFor = (meta: unknown): Record<string, unknown> =>
          typeof meta === "object" && meta !== null
            ? { ...tags, ...(meta as Record<string, unknown>) }
            : { ...tags };
        return {
          debug: (message, meta) => this.logger.debug?.(message, metaFor(meta)),
          info: (message, meta) => this.logger.info?.(message, metaFor(meta)),
          warn: (message, meta) => this.logger.warn(message, metaFor(meta)),
          error: (message, meta) => this.logger.error?.(message, metaFor(meta)),
        };
      },
      // The in-repo verticals own their monitors: Telegram's getUpdates
      // long-poll and Slack's Socket Mode live inside the package (L2), driven
      // by `plugin.gateway.startAccount`. The host exposes no
      // `monitorTelegramProvider` override any more — the vertical's L2 owns
      // the poll loop and hands each native event to its L3 processor.
      //
      // The shared L3 processor records + consume-marks its inbound rows
      // through this sink (blueprint §2.4): the adapter below writes them to
      // the channel event ledger via the account's orgId. Without it the L3
      // silently skips the ledger steps (blueprint §6 item 7).
      inboundLedger: this.inboundLedgerSink(organizationId, channel, accountId),
      inboundQueue: this.inboundQueueSink(organizationId, channel, accountId),
    });
    const vertical = await loadChannelVertical({
      channel,
      accountId,
      organizationId,
      installDir: install.installDir,
      mainInstallDir: install.mainInstallDir,
      channelInstallDir: install.channelInstallDir,
      entry: install.entry,
      // The plugin chunk + named export the control plane drives (load-channel.ts
      // D1): `plugin.gateway.startAccount` + `plugin.outbound`.
      plugin: pinEntry.plugin,
      loadMode: install.loadMode,
      hostRuntime,
      // hostBaseDir defaults to the compiled loader dir (load-channel.ts): the
      // supervisor must not pin its own `import.meta.url` — in the Vite bundle
      // that points into `.output/`, which ships no host modules.
    });
    return {
      vertical,
      hostRuntime,
      wireInbound: (handler: InboundReplyHandler) => {
        inbound = handler;
      },
    };
  }

  /**
   * Build the plane + the account's daemon connection, start the plane, and
   * drive the vertical's account monitor. Every step fails closed into the
   * handle (P13); `startAccount`'s catch releases whatever was half-built.
   */
  private async startTransport(
    handle: AccountHandle,
    snapshot: ChannelControlPlaneSnapshot,
    compiled: CompiledChannelAccount,
    loaded: LoadedVerticalBundle,
  ): Promise<void> {
    // The drive-time token context, resolved ONCE and shared by the post path
    // (the plugin's sendText reads `cfg`) and the account monitor (start-account.md).
    // A missing/inaccessible connection fails the account here (P13).
    const { account, cfg, providerApplicationId } = await accountAndCfg(
      this.options.resolveConnection ??
        this.options.database.resolveChannelConnection.bind(this.options.database),
      snapshot.organizationId,
      compiled,
      handle.accountId,
    );
    handle.connectionId = compiled.connectionId;
    registerChannelDriveConfig(
      {
        organizationId: snapshot.organizationId,
        channel: handle.channel,
        accountId: handle.accountId,
      },
      cfg,
    );
    const lookup = loaded.vertical.plugin.directory?.resolveConversation;
    if (lookup !== undefined) {
      handle.resolveConversation = createConversationMetadataResolver({
        channel: handle.channel,
        organizationId: snapshot.organizationId,
        connectionId: compiled.connectionId,
        accountId: handle.accountId,
        cfg,
        runtime: loaded.hostRuntime,
        lookup,
      });
    }
    if (compiled.channel === "slack" && this.options.claimSlackInbound !== undefined) {
      if (providerApplicationId === undefined) {
        throw new Error("the Slack connection has no Provider Application identity");
      }
      handle.releaseSlackInbound = await this.options.claimSlackInbound(
        providerApplicationId,
        handleKey(handle.channel, handle.accountId),
      );
    }
    // Kept on the handle: the tool-path MCP endpoint's `channelReplyPost`
    // posts through this SAME outbound seam (the vertical's `sendText`).
    const planePost = postFor(handle, cfg, loaded.hostRuntime, this.logger);
    // COMPAT(clisbot-control-plane): the account's native-media post (the
    // plugin's outbound.sendMedia, G7–G11); undefined when the plugin has no
    // sendMedia, which keeps the relay's media path a no-op (byte-identical).
    // The media home-root fallback is the shared daemon/Hub home — the same
    // home daemon discovery resolves (one home, one rule).
    const planeMediaPost = mediaPostFor(handle, cfg, loaded.hostRuntime, this.logger);
    // The turn-lifecycle surface (the plugin's optional outbound.typing);
    // undefined leaves the seam unmounted — an absent capability, not a fault.
    const planeTyping = typingFor(handle, cfg, loaded.hostRuntime);
    // The account's streaming surface (slice 22b), feature-detected off the
    // vertical's own `plugin.outbound`; undefined leaves the relay's
    // final-only post path exactly as it was.
    const planeStreaming = createStreamingDriver({
      channel: supportedChannel(compiled.channel),
      accountId: handle.accountId,
      cfg,
      hostRuntime: loaded.hostRuntime,
      outbound: loaded.vertical.plugin.outbound,
      logger: this.logger,
    });
    const plane = createChannelPlane({
      organizationId: snapshot.organizationId,
      channelRevisionId: snapshot.revision?.id ?? null,
      accountScope: {
        channel: supportedChannel(compiled.channel),
        accountId: compiled.accountId,
      },
      normalizeInbound: flatInboundNormalizer,
      envFlag: this.enabled(),
      controlPlane: snapshot.controlPlane,
      ...commandPlaneOptions(this.options),
      ...(this.options.authorizeChannelUse === undefined
        ? {}
        : { authorizeChannelUse: this.options.authorizeChannelUse }),
      ...(this.options.authorizeChannelApproval === undefined
        ? {}
        : { authorizeChannelApproval: this.options.authorizeChannelApproval }),
      ...(this.options.consumeChannelIdentityChallenge === undefined
        ? {}
        : {
            consumeChannelIdentityChallenge: this.options.consumeChannelIdentityChallenge,
          }),
      recordChannelInboundActivity: (input) => this.store.recordChannelInboundActivity(input),
      logger: this.logger,
      post: planePost,
      mediaPost: planeMediaPost,
      homeRoot: resolveHome(this.options.daemon?.home, this.env),
      // The approval card's in-place update (the plugin's optional
      // outbound.updateText; absent plugins fail closed per update).
      update: updateFor(handle, cfg, loaded.hostRuntime, this.logger),
      ...(planeTyping !== undefined ? { typing: planeTyping } : {}),
      ...(planeStreaming !== undefined ? { streaming: planeStreaming } : {}),
      resolveAgentSpec: snapshot.resolveAgentSpec,
      replyCapabilities: this.channelReplyCapabilities,
      resolveAgentAccessTarget: snapshot.resolveAgentAccessTarget,
      dispatchWorkflow:
        this.options.dispatchWorkflow ??
        (() => Promise.reject(new Error("channel workflow dispatcher is unavailable"))),
      workflowOutputStore: this.options.database,
    });
    handle.plane = plane;
    handle.post = planePost;
    handle.media = planeMediaPost;
    // Every inbound's outcome is logged (truthful status surface): the plane's
    // ignore reasons were otherwise unlogged in this path, making a running
    // account that silently drops every message indistinguishable from a dead
    // one.
    loaded.wireInbound(async (params) => {
      const result = await plane.onInbound(params);
      this.logPlaneOutcome(handle, result);
      return result;
    });
    const daemonOptions: ChannelDaemonClientOptions = {
      ...this.options.daemon,
      onStream: (payload) => {
        // P13: a channel fault must never reject the socket callback —
        // fire-and-forget into the plane, log the miss.
        void plane.onStreamEvent(payload.agentId, payload.event).catch((error: unknown) => {
          this.logger.warn("channel stream event failed", {
            channel: handle.channel,
            account: handle.accountId,
            error: errorMessage(error),
          });
        });
      },
      // The subagent frames ride the same socket, one fire-and-forget consumer
      // like `onStream` (P13).
      onSubagentUpdate: (frame) => {
        void plane.onSubagentFrame(frame).catch((error: unknown) => {
          this.logger.warn("channel subagent frame failed", {
            channel: handle.channel,
            account: handle.accountId,
            error: errorMessage(error),
          });
        });
      },
      // Light bookkeeping only: `agent_update` frames are the daemon's agent
      // state, not the channel plane's — no per-account action.
      onAgentUpdate: () => undefined,
      // The trusted session's state, per account. A flap here is the cause of
      // every "daemon client is not connected" inbound drop — an RPC that
      // lands in a reconnect gap fails closed with no other trace, so the
      // socket's own transitions are the operator's only lead.
      onStateChange: (state) => {
        if (state === "connected") {
          this.logger.info?.("channel daemon connected", {
            channel: handle.channel,
            account: handle.accountId,
          });
        } else {
          this.logger.warn("channel daemon disconnected", {
            channel: handle.channel,
            account: handle.accountId,
          });
        }
      },
    };
    // The daemon password defaults to the same env var the stock CLI client
    // reads (PASEO_PASSWORD): a password-protected local daemon otherwise
    // rejects the trusted session at the WS upgrade.
    if (daemonOptions.password === undefined) {
      const password = this.env["PASEO_PASSWORD"]?.trim();
      if (password !== undefined && password !== "") daemonOptions.password = password;
    }
    this.applyChannelAdmissionTicket(daemonOptions, handle, compiled, snapshot);
    await this.applyDaemonTarget(daemonOptions, handle, compiled, snapshot);
    const daemon = connectChannelDaemon(daemonOptions);
    handle.daemon = daemon;
    await plane.start(daemon, this.store);
    // Drain payloads admitted before a previous process stopped. The drain is
    // account-scoped and uses transactional claim leases from ChannelStore;
    // start it only after the plane is ready to receive events.
    this.startInboundDrain(handle, loaded.hostRuntime);
    this.drive(handle, { account, cfg }, loaded.hostRuntime);
  }

  /**
   * Phase-1 channel admission (docs/audits/2026-09-10): present a managed-access
   * ticket so the account's socket is admitted when its daemon runs `external`
   * mode. One stable clientId per account → one distinct lease; the resolver
   * returns undefined (no ticket, trusted session as today) for an `off` daemon
   * or an account with no daemon route.
   */
  private applyChannelAdmissionTicket(
    daemonOptions: ChannelDaemonClientOptions,
    handle: AccountHandle,
    compiled: CompiledChannelAccount,
    snapshot: ChannelControlPlaneSnapshot,
  ): void {
    if (this.options.buildDaemonAccessTicketResolver === undefined) return;
    const daemonReference = accountDaemonReference(compiled, snapshot.resolveAgentAccessTarget);
    if (daemonReference === undefined) return;
    const clientId = handleKey(handle.channel, handle.accountId);
    daemonOptions.clientId = clientId;
    daemonOptions.resolveAccessTicket = this.options.buildDaemonAccessTicketResolver({
      organizationId: snapshot.organizationId,
      daemonReference,
      clientId,
    });
  }

  /**
   * Per-daemon connection target + loud failure. Resolves the account's route
   * daemon to its persisted `ConnectionOffer` candidates (direct → relay) — the
   * same path any trusted client (app/web) reaches it by, so channels are
   * multi-daemon by construction — and installs the loud `onConnectFailure` that
   * replaces the silent `channel daemon disconnected` loop. No resolver / no
   * offer → the global `daemon` option (env) or loopback discovery stands.
   */
  private async applyDaemonTarget(
    daemonOptions: ChannelDaemonClientOptions,
    handle: AccountHandle,
    compiled: CompiledChannelAccount,
    snapshot: ChannelControlPlaneSnapshot,
  ): Promise<void> {
    daemonOptions.onConnectFailure = (info) => {
      (this.logger.error ?? this.logger.warn).call(
        this.logger,
        "channel daemon unreachable: all candidates failed",
        {
          channel: handle.channel,
          account: handle.accountId,
          candidates: info.candidates,
          attempts: info.attempts,
          ...(info.lastError !== undefined ? { lastError: info.lastError } : {}),
          hint: "verify the daemon's ConnectionOffer / PASEO_HUB_CHANNEL_DAEMON_URL / daemon reachability",
        },
      );
    };
    if (this.options.resolveDaemonTarget === undefined) return;
    const daemonReference = accountDaemonReference(compiled, snapshot.resolveAgentAccessTarget);
    if (daemonReference === undefined) return;
    try {
      const urls = await this.options.resolveDaemonTarget({
        organizationId: snapshot.organizationId,
        daemonReference,
      });
      if (urls.length > 0) daemonOptions.urls = urls;
    } catch (error) {
      this.logger.warn("channel daemon target resolution failed", {
        channel: handle.channel,
        account: handle.accountId,
        error: errorMessage(error),
      });
    }
  }

  /**
   * The inbound's structured outcome, logged per message. `bound` / `steered`
   * are the happy path (info, with the agent); `ignored` carries the plane's
   * exact reason (why an admitted-looking message did not reach the agent);
   * `command` is an approval-command answer.
   */
  private logPlaneOutcome(handle: AccountHandle, result: PlaneInboundResult): void {
    const outcome = result.outcome;
    if (outcome === undefined) return;
    const base = {
      channel: handle.channel,
      account: handle.accountId,
      dispatched: result.dispatched,
    };
    switch (outcome.kind) {
      case "bound":
        this.logger.info?.("channel inbound bound a conversation", {
          ...base,
          ...(outcome.conversationLabel !== undefined
            ? { conversationLabel: outcome.conversationLabel }
            : {}),
          agentId: outcome.agentId,
          newSession: outcome.newSession,
        });
        break;
      case "steered":
        this.logger.info?.("channel inbound steered an existing session", {
          ...base,
          ...(outcome.conversationLabel !== undefined
            ? { conversationLabel: outcome.conversationLabel }
            : {}),
          agentId: outcome.agentId,
        });
        break;
      case "command":
        this.logger.info?.("channel inbound answered an approval command", {
          ...base,
          handled: outcome.handled,
          detail: outcome.detail,
        });
        break;
      case "ignored":
        // The message never reached the agent: the reason is the operator's
        // only lead (route miss, kill switch, mention policy, permissions).
        this.logger.warn("channel inbound ignored", {
          ...base,
          reason: outcome.reason,
        });
        break;
    }
  }

  /**
   * The native card click's structured outcome, logged like
   * `logPlaneOutcome` — the button path otherwise has no logging surface at
   * all: a click that dies on a route miss, unbound session, privilege
   * check, or stale prompt is indistinguishable from a click that never
   * arrived.
   */
  private logApprovalCallbackOutcome(handle: AccountHandle, result: PlaneInboundResult): void {
    const outcome = result.outcome;
    if (outcome === undefined) return;
    const base = {
      channel: handle.channel,
      account: handle.accountId,
      dispatched: result.dispatched,
    };
    switch (outcome.kind) {
      case "command":
        this.logger.info?.("channel card click answered an approval command", {
          ...base,
          handled: outcome.handled,
          detail: outcome.detail,
        });
        break;
      case "ignored":
        this.logger.warn("channel card click ignored", {
          ...base,
          reason: outcome.reason,
        });
        break;
    }
  }

  /**
   * Drive the vertical's account monitor (`plugin.gateway.startAccount` — the
   * plugin chunk, not the entry; `entry.gateway` does not exist on the pinned
   * verticals). The monitor's lifetime is the account's: a reject or a clean
   * exit lands in the transport state (P13), never outward. A plugin without a
   * gateway fails closed: the plane alone cannot drive the account's transport.
   */
  private drive(
    handle: AccountHandle,
    driveContext: {
      account: Record<string, unknown>;
      cfg: Record<string, unknown>;
    },
    hostRuntime: HostRuntime,
  ): void {
    const gateway = handle.vertical?.plugin?.gateway;
    const start = gateway !== undefined ? gateway.startAccount : undefined;
    if (typeof start !== "function") {
      this.logger.warn(
        "channel plugin exposes no gateway.startAccount; the account cannot be driven",
        {
          channel: handle.channel,
          account: handle.accountId,
        },
      );
      return;
    }
    const monitor = Promise.resolve(
      start(this.startAccountContext(handle, driveContext, hostRuntime)),
    );
    const observed = this.observeMonitor(handle, monitor);
    handle.monitor = observed;
    void observed.finally(() => {
      if (handle.monitor === observed) handle.monitor = undefined;
    });
  }

  /**
   * The monitor's outcome, observed to the transport state: a clean exit marks
   * the account `stopped` (the monitor owns the account's lifetime); a reject
   * marks it `failed` (P13: logged, never thrown).
   */
  private async observeMonitor(handle: AccountHandle, monitor: Promise<unknown>): Promise<void> {
    try {
      await monitor;
      if (handle.transport === "started") {
        handle.transport = "stopped";
        this.logger.info?.("channel account monitor exited", {
          channel: handle.channel,
          account: handle.accountId,
        });
      }
    } catch (error) {
      const detail = errorMessage(error);
      handle.detail = detail;
      // A QR-auth account with no live session is not broken, it is unlinked:
      // the operator's next step is the QR login, not a retry (needs-login.ts).
      handle.transport = monitorFailureTransport(handle.channel, detail);
      if (handle.transport === "needs-login") {
        this.logger.warn("channel account needs a QR login", {
          channel: handle.channel,
          account: handle.accountId,
          detail,
        });
        return;
      }
      this.logger.error?.("channel account monitor failed", {
        channel: handle.channel,
        account: handle.accountId,
        error: detail,
      });
    }
  }

  private startAccountContext(
    handle: AccountHandle,
    driveContext: {
      account: Record<string, unknown>;
      cfg: Record<string, unknown>;
    },
    hostRuntime: HostRuntime,
  ): StartAccountContext {
    let statusState: unknown;
    return {
      accountId: handle.accountId,
      account: driveContext.account,
      cfg: driveContext.cfg,
      runtime: {
        log: (...args: unknown[]) =>
          this.logger.info?.("channel account log", {
            channel: handle.channel,
            account: handle.accountId,
            args,
          }),
        error: (...args: unknown[]) =>
          this.logger.error?.("channel account error", {
            channel: handle.channel,
            account: handle.accountId,
            args,
          }),
        exit: (code: number) => {
          this.logger.warn("channel account requested exit", {
            channel: handle.channel,
            account: handle.accountId,
            code,
          });
          void this.stopHandle(handle);
        },
      },
      abortSignal: handle.abortController.signal,
      setStatus: (status: unknown) => {
        statusState = status;
      },
      getStatus: () => statusState,
      log: hostRuntime.logging.getChildLogger({
        channel: handle.channel,
        account: handle.accountId,
      }),
      // Group G: the account's inbound-media download dir (the L2 transport
      // streams Bot API files here; the `[Attached files]` manifest points
      // the agent at absolute paths under it).
      mediaDownloadDir: this.accountDir(
        {
          // A started handle always carries its organization; the fallback only
          // keeps the path total for a handle still being reconciled.
          organizationId: handle.organizationId ?? "unscoped",
          channel: handle.channel,
          accountId: handle.accountId,
        },
        "downloads",
      ),
      // COMPAT(clisbot-control-plane): the native approval card's
      // button-click seam. The vertical's L2 transport (Slack Socket Mode
      // `interactive` events; Telegram `callback_query` — the poll loop's
      // deferred half) hands each parsed click to the plane's
      // onApprovalCallback: the SAME exactly-once resolver + two authority
      // checks as a typed command. The click is data — no authority.
      channelRuntime: {
        approvalAction: (params: Record<string, unknown>): Promise<PlaneInboundResult> => {
          const plane = handle.plane;
          if (plane === undefined) {
            return Promise.resolve({
              dispatched: false,
              outcome: { kind: "ignored", reason: "plane not started" },
            } as PlaneInboundResult);
          }
          const callback: ApprovalCallbackParams = {
            channel: handle.channel,
            accountId: handle.accountId,
            senderIdentity:
              typeof params["senderIdentity"] === "string" ? params["senderIdentity"] : "",
            cardValue: typeof params["cardValue"] === "string" ? params["cardValue"] : "",
            externalConversationId:
              typeof params["externalConversationId"] === "string"
                ? params["externalConversationId"]
                : "",
            externalThreadId:
              typeof params["externalThreadId"] === "string" ? params["externalThreadId"] : null,
            rootKind:
              params["rootKind"] === "dm" ||
              params["rootKind"] === "channel" ||
              params["rootKind"] === "group"
                ? params["rootKind"]
                : "channel",
          };
          const result = plane.onApprovalCallback(callback);
          void result.then((outcome) => this.logApprovalCallbackOutcome(handle, outcome));
          return result;
        },
      },
      hostRuntime,
    };
  }

  /** Stop one account; a policy replacement also revokes Route-owned work.
   *
   * `retireCapabilities` is the account going away for good (reconcile removed
   * it, or a replacement is about to re-create it), NOT any stop: a Hub
   * shutdown, a monitor fault and a failed start all leave the durable reply
   * capabilities in place, because the Agents holding those MCP URLs outlive
   * the process and must still be able to answer (D-W4-01). */
  private async stopHandle(
    handle: AccountHandle,
    options: { cancelActive?: boolean; retireCapabilities?: boolean } = {},
  ): Promise<void> {
    if (handle.organizationId !== undefined && options.retireCapabilities === true) {
      this.channelReplyCapabilities.revokeAccount(
        handle.organizationId,
        handle.channel,
        handle.accountId,
      );
    }
    handle.abortController.abort();
    const drain = this.drains.get(handleKey(handle.channel, handle.accountId));
    if (drain !== undefined) {
      this.drains.delete(handleKey(handle.channel, handle.accountId));
      await drain.stop();
    }
    if (handle.plane !== undefined) await handle.plane.stop(options);
    else if (handle.daemon !== undefined) handle.daemon.stop();
    // Bounded: a gateway that ignores its abort must not spend the process's
    // whole shutdown budget (`monitor-stop.ts`).
    await awaitMonitorExit(handle.monitor, {
      onLingering: () => {
        this.logger.warn("channel account monitor did not exit within the stop grace", {
          channel: handle.channel,
          account: handle.accountId,
          graceMs: MONITOR_STOP_GRACE_MS,
        });
      },
    });
    handle.vertical?.dispose();
    const release = handle.releaseSlackInbound;
    handle.releaseSlackInbound = undefined;
    if (release !== undefined) await release();
    handle.transport = "stopped";
  }

  /**
   * Drop every encrypted keyed-store namespace an account owned. Called when
   * the account leaves the configuration, never when it is merely disabled or
   * restarted: unlinking is `logout`'s job and deliberately leaves the
   * vertical's revocation marker instead
   * (`packages/channels/zalouser/HUB-WIRING.md` §6).
   */
  private async forgetAccountSecrets(handle: AccountHandle): Promise<void> {
    const { channel, accountId, organizationId } = handle;
    if (organizationId === undefined || !isSupportedChannel(channel)) return;
    if (encryptedStateNamespaces(channel).length === 0) return;
    try {
      await this.options.database.deleteChannelStateSecrets({
        organizationId,
        channel,
        accountId,
      });
    } catch (error) {
      // P13: a store fault is logged, never thrown out of reconcile.
      this.logger.error?.("channel account secret state could not be removed", {
        channel,
        account: accountId,
        error: errorMessage(error),
      });
    }
  }

  /** Stop + forget one handle (reconcile removes, replacement re-creates). */
  private async teardown(handle: AccountHandle | undefined): Promise<void> {
    if (handle === undefined) return;
    this.handles.delete(handleKey(handle.channel, handle.accountId));
    this.accountState.delete(handleKey(handle.channel, handle.accountId));
    await this.stopHandle(handle, { cancelActive: true, retireCapabilities: true });
  }

  /** Keep the account's keyed-store root: the QR link path awaits its `flush`
   * before it answers, and only the load knows which root the vertical got. */
  private rememberAccountState(
    channel: string,
    accountId: string,
    state: HostKeyedStoreRoot,
  ): HostKeyedStoreRoot {
    this.accountState.set(handleKey(channel, accountId), state);
    return state;
  }

  /**
   * The encrypted keyed-store backing for one account, or nothing when the
   * channel keeps no credential material in its keyed store. Opened before the
   * root because the store seam is synchronous: the snapshot has to be in hand
   * by the time the vertical first reads a credential.
   */
  private async secretState(
    channel: string,
    accountId: string,
    organizationId: string,
  ): Promise<{ secret?: { namespaces: readonly string[]; backend: KeyedStoreBackend } }> {
    const namespaces = encryptedStateNamespaces(channel);
    if (namespaces.length === 0 || !isSupportedChannel(channel)) return {};
    const backend = await openChannelSecretStateBackend({
      database: this.options.database,
      scope: { organizationId, channel, accountId },
    });
    return { secret: { namespaces, backend } };
  }

  /**
   * One account's on-disk root, scoped by organization and channel.
   *
   * An account id is only unique inside one organization's channel: two tenants
   * that both name their workspace `support`, or one tenant running `support`
   * on Slack and on Telegram, would otherwise share a poll offset, a dedupe
   * cache and a downloads dir — one account reading another's inbound state.
   */
  private accountDir(
    scope: { organizationId: string; channel: string; accountId: string },
    leaf: string,
  ): string {
    return join(
      this.options.dataDir,
      "channels",
      scope.organizationId,
      scope.channel,
      scope.accountId,
      leaf,
    );
  }

  /**
   * COMPAT(clisbot-channel-account-dir): before the scope was in the path, this
   * was `channels/<accountId>/<leaf>`. Move the old directory into place the
   * first time the account starts so a Hub restart keeps its poll offset
   * instead of replaying the backlog. Remove once no deployment predates it.
   */
  private async adoptLegacyAccountDir(
    scope: { organizationId: string; channel: string; accountId: string },
    leaf: string,
  ): Promise<string> {
    const scoped = this.accountDir(scope, leaf);
    const legacy = join(this.options.dataDir, "channels", scope.accountId, leaf);
    try {
      await mkdir(dirname(scoped), { recursive: true });
      await rename(legacy, scoped);
      this.logger.info?.("adopted a pre-scope channel account directory", {
        channel: scope.channel,
        account: scope.accountId,
        leaf,
      });
    } catch {
      // Already migrated, never existed, or the scoped dir is in use: either
      // way the scoped path below is the one the account runs on.
    }
    return scoped;
  }

  /**
   * Start the account's durable ingress drain. It runs one pass immediately
   * (the restart drain for payloads admitted before this process), then on its
   * own timer for retry-due and recovered rows; `inboundQueueSink.enqueue`
   * wakes it so a live event does not wait for the next tick.
   */
  private startInboundDrain(handle: AccountHandle, hostRuntime: HostRuntime): void {
    const queue = hostRuntime.inboundQueue;
    const organizationId = handle.organizationId;
    if (queue === undefined || organizationId === undefined) return;
    const drain = createChannelIngressDrain({
      queue,
      organizationId,
      channel: handle.channel,
      accountId: handle.accountId,
      workerId: `${handle.channel}:${handle.accountId}:drain`,
      abortSignal: handle.abortController.signal,
      resolveNonRetryableFailure: resolveHubIngressNonRetryableFailure,
      dispatch: (payload) => this.dispatchInbound(handle, hostRuntime, payload),
      log: this.inboundDrainLog(handle),
    });
    this.drains.set(handleKey(handle.channel, handle.accountId), drain);
    drain.start();
  }

  /**
   * Hand one claimed payload to the plane. A throw here is the drain's failure
   * signal. `dispatched: false` is terminal — the plane decided to drop the
   * event — and completes the claim, unless the plane also returned a deferral:
   * that is back-pressure, and the drain releases the row so the message comes
   * back instead of disappearing.
   */
  private async dispatchInbound(
    handle: AccountHandle,
    hostRuntime: HostRuntime,
    payload: unknown,
  ): Promise<ChannelIngressDeferral | undefined> {
    const params = payload as InboundReplyParams;
    const result = await hostRuntime.onInboundReply(params);
    if (!result.dispatched) {
      const deferral = planeInboundDeferral(result);
      if (deferral !== undefined) return { kind: "deferred", ...deferral };
    }
    if (!result.dispatched || hostRuntime.inboundLedger === undefined) return undefined;
    const context = params.ctxPayload;
    const conversationId = context?.["ChatId"];
    const messageId = context?.["MessageSid"];
    if (typeof conversationId !== "string" || typeof messageId !== "string") return undefined;
    await hostRuntime.inboundLedger.consume({
      channel: handle.channel,
      accountId: handle.accountId,
      externalConversationId: conversationId,
      externalMessageId: messageId,
      turnId: `${handle.channel}:${messageId}`,
    });
    return undefined;
  }

  /**
   * Operator-visible drain outcomes: dead-letters are loud, retries and lost
   * claims are warnings, a plane deferral is routine back-pressure.
   */
  private inboundDrainLog(handle: AccountHandle): ChannelIngressDrainLog {
    const base = { channel: handle.channel, account: handle.accountId };
    return {
      drained: (claim) => {
        this.logger.info?.("channel inbound queue drained", { ...base, event: claim.id });
      },
      retried: (claim, detail) => {
        this.logger.warn("channel inbound drain failed; retry scheduled", {
          ...base,
          event: claim.id,
          attempts: claim.attempts,
          retryAt: detail.retryAt.toISOString(),
          error: detail.message,
        });
      },
      deferred: (claim, detail) => {
        this.logger.info?.("channel inbound event deferred by the plane", {
          ...base,
          event: claim.id,
          retryAt: detail.retryAt.toISOString(),
          reason: detail.reason,
        });
      },
      abandoned: (claim, detail) => {
        this.logger.warn("channel inbound claim abandoned; another worker owns it", {
          ...base,
          event: claim.id,
          attempts: claim.attempts,
          reason: detail.reason,
        });
      },
      deadLettered: (claim, detail) => {
        this.logger.error?.("channel inbound event dead-lettered", {
          ...base,
          event: claim.id,
          attempts: claim.attempts,
          reason: detail.reason,
          error: detail.message,
        });
      },
      faulted: (error) => {
        this.logger.warn("channel inbound queue drain unavailable", {
          ...base,
          error: errorMessage(error),
        });
      },
    };
  }

  /**
   * The account's durable ingress boundary (`ingress/queue-sink.ts`). Admission
   * wakes the account's drain so a live message does not wait for the timer.
   */
  private inboundQueueSink(
    organizationId: string,
    channel: string,
    accountId: string,
  ): InboundQueueSink {
    return createChannelIngressQueueSink({
      store: this.store,
      organizationId,
      channel,
      accountId,
      onAdmitted: () => this.drains.get(handleKey(channel, accountId))?.requestDrain(),
      // A release that ended the row is not back-pressure any more, it is a
      // stuck message an operator has to resubmit or drop.
      onReleaseBudgetExhausted: (record) => {
        this.logger.error?.("channel inbound event released past its budget", {
          channel,
          account: accountId,
          event: record.id,
          releases: record.releases,
          reason: record.failedReason,
          error: record.lastError,
        });
      },
    });
  }

  /**
   * The inbound ledger sink the shared L3 processor records into (blueprint
   * §2.4 / §6 item 7). An adapter over the channel event ledger: `record`
   * writes the pre-handoff `in` row (dedupe on the external message id) and
   * `consume` marks it consumed when the dispatch settles, referencing the
   * plane's turn. `orgId` comes from the account's row; `consumedAt` is now.
   * A ledger fault is logged, not thrown into the transport (P13).
   */
  private inboundLedgerSink(
    organizationId: string,
    channel: string,
    accountId: string,
  ): InboundLedgerSink {
    const store = this.store;
    const channelKey = supportedChannel(channel);
    return {
      record: async (params) => {
        const { created } = await store.recordInbound({
          organizationId,
          channel: channelKey,
          accountId,
          externalConversationId: params.externalConversationId,
          externalMessageId: params.externalMessageId,
        });
        return { created };
      },
      consume: async (params) => {
        await store.consumeInbound({
          organizationId,
          accountId,
          externalConversationId: params.externalConversationId,
          externalMessageId: params.externalMessageId,
          turnId: params.turnId,
          consumedAt: new Date(),
        });
      },
    };
  }
}

/**
 * Build the channel supervisor. Sync factory: the composition root constructs
 * it at startup (application-runtime.ts) and drives it through the
 * `ChannelSupervisor` contract.
 */
export function createChannelSupervisor(options: ChannelSupervisorOptions): ChannelSupervisor {
  return new ChannelSupervisorImpl(options);
}

function commandPlaneOptions(options: ChannelSupervisorOptions) {
  return {
    ...(options.commandAccess ? { commandAccess: options.commandAccess } : {}),
    ...(options.readWorkflowRuns ? { readWorkflowRuns: options.readWorkflowRuns } : {}),
    ...(options.cancelWorkflowRuns ? { cancelWorkflowRuns: options.cancelWorkflowRuns } : {}),
    ...(options.appWebUrl ? { appWebUrl: options.appWebUrl } : {}),
  };
}
