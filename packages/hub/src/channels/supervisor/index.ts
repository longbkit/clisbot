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

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadChannelControlPlane, type ChannelControlPlaneSnapshot } from "../control-plane.js";
import type { CompiledChannelAccount } from "../config/compile.js";
import { ChannelStore } from "../../db/channels.js";
import {
  connectChannelDaemon,
  type ChannelDaemonClientOptions,
  type DaemonConnection,
} from "../daemon/client.js";
import { createChannelPlane, type ChannelPlane } from "../execution.js";
import {
  ensureChannelInstalled,
  InstallError,
  type ChannelInstallResult,
} from "../install/install-channel.js";
import { ProvisionError } from "../install/provision-main.js";
import { loadChannelPins, type ChannelPinEntry } from "../install/pins.js";
import { isChannelsEnabled } from "../loader/channel-gate.js";
import {
  createHostRuntime,
  type HostRuntime,
  type InboundLedgerSink,
  type InboundReplyParams,
  type InboundReplyResult,
  type StartAccountContext,
} from "../loader/host.js";
import { loadChannelVertical, type LoadedChannelVertical } from "../loader/load-channel.js";
import { setChannelSeamLogger } from "../loader/seam-logger.js";
import { isEnabled } from "../policy.js";
import type {
  ApprovalCallbackParams,
  ChannelReplyBindingRef,
  InboundMessage,
  MediaPostFn,
  MediaPostResult,
  OutboundPostResult,
  PlaneInboundResult,
  PlaneLogger,
  PostFn,
  P0ChannelName,
  UpdateFn,
  TypingFn,
} from "../plane/types.js";
import { resolveHome } from "../daemon/discovery.js";
import { createHostKeyedStoreRoot } from "../state/keyed-store.js";
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
  if ((params.channel !== "slack" && params.channel !== "telegram") || accountId === null)
    return null;
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
): MediaPostFn | undefined {
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
 * .accounts` holds EXACTLY ONE entry (Telegram's `findTelegramTokenOwnerAccountId`
 * throws on a duplicate token).
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
  const credentials = await resolveConnection({
    organizationId,
    channel: compiled.channel === "slack" ? "slack" : "telegram",
    connectionId: compiled.connectionId,
  });
  if (credentials === undefined) throw new Error("the channel connection is unavailable");
  const { botToken, appToken, providerApplicationId } = credentials;
  if (compiled.channel === "slack" && appToken === undefined) {
    throw new Error("the Slack connection requires a Socket Mode Provider Application");
  }
  const account: Record<string, unknown> =
    compiled.channel === "slack"
      ? {
          accountId,
          botToken,
          ...(appToken !== undefined ? { appToken } : {}),
          config: {},
          // The compiled transport record rides the flat carrier so the
          // vertical's start-account can read channel-behavior knobs it owns
          // (e.g. `slashCommand` — the native slash-command alias the L2
          // rewrites; commands.ts). Tokens still come only from the carrier +
          // connection metadata; this carries no secret.
          transport: compiled.transport,
        }
      : { accountId, token: botToken, config: {} };
  // The vertical-owned `config` block rides the cfg entry so the vertical's
  // account resolution reads its own knobs (e.g. Telegram `richMessages` —
  // D-003) from the compiled revision instead of a hardcoded default.
  const cfgAccount: Record<string, unknown> =
    compiled.channel === "slack"
      ? {
          botToken,
          config: compiled.config,
          ...(appToken !== undefined ? { appToken } : {}),
        }
      : { botToken, gatewayClientScopes: [], config: compiled.config };
  return {
    account,
    cfg: {
      channels: {
        [compiled.channel]: { accounts: { [accountId]: cfgAccount } },
      },
    },
    ...(providerApplicationId === undefined ? {} : { providerApplicationId }),
  };
}
interface AccountHandle {
  channel: string;
  accountId: string;
  organizationId?: string;
  revisionId: string | null;
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
  media?: MediaPostFn | undefined;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A confirmed string field, or null (the conservative normalizer's read). */
function confirmedString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

class ChannelSupervisorImpl implements ChannelSupervisor {
  readonly channelReplyCapabilities = new ChannelReplyCapabilityRegistry();
  private readonly options: ChannelSupervisorOptions;
  private readonly env: NodeJS.ProcessEnv;
  private readonly logger: PlaneLogger;
  private readonly store: ChannelStore;
  private readonly pinsPath: string;
  private readonly handles = new Map<string, AccountHandle>();

  constructor(options: ChannelSupervisorOptions) {
    this.options = options;
    this.env = options.env ?? process.env;
    this.logger = options.logger ?? NO_OP_LOGGER;
    this.store = new ChannelStore(options.databaseRuntime);
    this.pinsPath =
      options.pinsPath ?? fileURLToPath(new URL("../../../channel-pins.json", import.meta.url));
    // The bound seam module (a separate compilation, drive-time) reports its
    // no-runtime miss through this sink; without it the miss is a silent
    // no-dispatch the operator cannot see (seam-logger.ts).
    setChannelSeamLogger(this.logger);
  }

  async startAll(): Promise<void> {
    if (!this.enabled()) return;
    let snapshot: ChannelControlPlaneSnapshot;
    try {
      snapshot = await loadChannelControlPlane(this.options.database);
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
      const snapshot = await loadChannelControlPlane(this.options.database);
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
      const install = await ensureChannelInstalled(pins, channel, accountId, this.options.dataDir);
      handle.install = install;
      handle.integrity = "ok";
      handle.pin = `${pins.main.package}@${pins.main.version}`;
      const loaded = await this.loadVertical(
        channel,
        accountId,
        install,
        pinEntry,
        snapshot.organizationId,
      );
      handle.vertical = loaded.vertical;
      handle.loadTrace = "ok";
      await this.startTransport(handle, snapshot, compiled, loaded);
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
      snapshot = await loadChannelControlPlane(this.options.database);
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
    const stopped: { channel: string; account: string }[] = [];
    // A Map iterator tolerates deleting the entry it is on; no snapshot needed.
    for (const [key, handle] of this.handles) {
      if (desired.has(key)) continue;
      this.handles.delete(key);
      await this.stopHandle(handle, { cancelActive: true });
      stopped.push({ channel: handle.channel, account: handle.accountId });
    }
    const accounts: ChannelAccountStartResult[] = [];
    for (const account of snapshot.controlPlane.accounts) {
      const key = handleKey(account.channel, account.accountId);
      const handle = this.handles.get(key);
      const activeRevisionId = snapshot.revision?.id ?? null;
      if (
        !desired.has(key) ||
        (handle !== undefined &&
          handle.transport === "started" &&
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
  async channelReplyPost(ref: ChannelReplyBindingRef, text: string): Promise<OutboundPostResult> {
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
    });
  }

  async channelReplyMediaPost(
    ref: ChannelReplyBindingRef,
    filePath: string,
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
      filePath,
    });
  }

  async postTestMessage(input: {
    channel: P0ChannelName;
    accountId: string;
    conversationId: string;
    threadId?: string | undefined;
  }): Promise<OutboundPostResult> {
    const handle = this.handles.get(handleKey(input.channel, input.accountId));
    const post = handle?.post;
    if (handle === undefined || post === undefined || handle.transport !== "started") {
      return {
        ok: false,
        error: `the ${input.channel} account ${input.accountId} is not started`,
      };
    }
    return post({
      channel: input.channel,
      accountId: input.accountId,
      to: input.conversationId,
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      text: "Paseo Channel test — the Connection can send messages.",
    });
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
      // survive a Hub restart (state/keyed-store.ts).
      state: createHostKeyedStoreRoot({ dir: this.stateDir(accountId) }),
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
    });
    const vertical = await loadChannelVertical({
      channel,
      accountId,
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
    const plane = createChannelPlane({
      organizationId: snapshot.organizationId,
      channelRevisionId: snapshot.revision?.id ?? null,
      accountScope: {
        channel: compiled.channel === "slack" ? "slack" : "telegram",
        accountId: compiled.accountId,
      },
      normalizeInbound: flatInboundNormalizer,
      envFlag: this.enabled(),
      controlPlane: snapshot.controlPlane,
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
    const daemon = connectChannelDaemon(daemonOptions);
    handle.daemon = daemon;
    await plane.start(daemon, this.store);
    this.drive(handle, { account, cfg }, loaded.hostRuntime);
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
      handle.transport = "failed";
      handle.detail = errorMessage(error);
      this.logger.error?.("channel account monitor failed", {
        channel: handle.channel,
        account: handle.accountId,
        error: errorMessage(error),
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
      mediaDownloadDir: join(this.options.dataDir, "channels", handle.accountId, "downloads"),
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

  /** Stop one account; a policy replacement also revokes Route-owned work. */
  private async stopHandle(
    handle: AccountHandle,
    options: { cancelActive?: boolean } = {},
  ): Promise<void> {
    if (handle.organizationId !== undefined) {
      this.channelReplyCapabilities.revokeAccount(
        handle.organizationId,
        handle.channel,
        handle.accountId,
      );
    }
    handle.abortController.abort();
    if (handle.plane !== undefined) await handle.plane.stop(options);
    else if (handle.daemon !== undefined) handle.daemon.stop();
    await handle.monitor;
    handle.vertical?.dispose();
    const release = handle.releaseSlackInbound;
    handle.releaseSlackInbound = undefined;
    if (release !== undefined) await release();
    handle.transport = "stopped";
  }

  /** Stop + forget one handle (reconcile removes, replacement re-creates). */
  private async teardown(handle: AccountHandle | undefined): Promise<void> {
    if (handle === undefined) return;
    this.handles.delete(handleKey(handle.channel, handle.accountId));
    await this.stopHandle(handle, { cancelActive: true });
  }

  private stateDir(accountId: string): string {
    return join(this.options.dataDir, "channels", accountId, "state");
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
    const channelKey = channel as "slack" | "telegram";
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
