// The Hub's edge of the ported OpenClaw message-action layer
// (`@getpaseo/channels-core`, slice 11 of
// docs/audits/2026-09-07-openclaw-channel-port-goal.md).
//
// Two responsibilities, both Fusion-owned:
//
//  1. A per-account registry of the channel vertical's
//     `ChannelMessageActionAdapter`. Upstream discovers adapters from an ambient
//     process plugin registry; Fusion has none, so the channel loader registers
//     the adapter it actually loaded (`registerChannelMessageActions`) and this
//     module scopes it into core's discovery for the duration of one call.
//
//  2. The runner's send boundary. `runMessageAction` calls core's durable sender
//     for `action: "send"`; the Hub owns delivery, so
//     `runWithCoreOutboundSender` supplies a sender backed by the caller's
//     outbound seam. Non-send actions never reach it — they go through
//     `dispatchChannelMessageAction` to the vertical's `handleAction`.
//
// Both installs are per call (`AsyncLocalStorage`), not per process: one Hub
// serves many accounts and organizations concurrently.
//
// The Hub never advertises an action it cannot run: `resolveExecutableActions`
// answers "send plus whatever the registered adapter handles", and the tool
// refuses everything else with a structured `unsupported_action` result.

import {
  runWithChannelMessageToolPlugins,
  type PreparedMessageToolCatalog,
  buildPreparedMessageToolCatalog,
} from "@getpaseo/channels-core/channels/plugins/message-action-discovery.host-adapter";
import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
  ChannelOutboundAdapter,
  ChannelPlugin as CoreChannelPlugin,
  ChannelThreadingToolContext,
  OpenClawConfig,
} from "@getpaseo/channels-core/channels/plugins/types.public.host-adapter";
import type { MessagePresentation } from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";
import { CHANNEL_MESSAGE_ACTION_NAMES } from "@getpaseo/channels-core/channels/plugins/message-action-names";
import { MESSAGE_ACTION_TARGET_MODE } from "@getpaseo/channels-core/infra/outbound/message-action-spec";
import { redactSensitiveText } from "@getpaseo/channels-core/logging/redact";
import {
  getToolResult,
  runMessageAction,
} from "@getpaseo/channels-core/infra/outbound/message-action-runner";
import {
  resolveMessageActionMessageId,
  resolveMessageActionOutcome,
  type MessageActionResult,
} from "@getpaseo/channels-core/infra/outbound/message-action-contracts";
import {
  runWithCoreOutboundSender,
  type CoreOutboundSender,
  type MessageSendParams,
  type MessageSendResult,
} from "@getpaseo/channels-core/infra/outbound/message.host-adapter";
import {
  runWithChannelMediaStager,
  type ChannelMediaSource,
  type ChannelMediaStager,
  type StagedChannelMedia,
} from "./media/outbound-stager.js";

/**
 * The account a registration, a lookup or a tool call belongs to.
 *
 * One Hub process serves every organization, so the account id alone is not a
 * name: two tenants that both call their Slack workspace `support` would share
 * one entry, and whichever vertical loaded last would decide which adapter and
 * which drive-time credentials the other tenant's agents reach.
 */
export interface ChannelAccountScope {
  organizationId: string;
  channel: string;
  accountId: string;
}

const registry = new Map<string, ChannelMessageActionAdapter>();
// The account's presentation-rendering outbound surface, when its vertical has
// one (`readPluginPresentationOutbound`). Core reads it to decide whether a
// portable `presentation` survives to the post seam or is flattened first.
const presentationOutbounds = new Map<string, ChannelOutboundAdapter>();
// The drive-time `cfg` the supervisor resolved for the account (token +
// vertical-owned knobs). Ported verticals resolve credentials from it, so a
// Hub-dispatched action must see the same object the send path sees — not `{}`.
const driveConfigs = new Map<string, OpenClawConfig>();

function key(scope: ChannelAccountScope): string {
  return `${scope.organizationId}:${scope.channel}:${scope.accountId}`;
}

/** Remembers the account's drive-time cfg for tool-dispatched actions. */
export function registerChannelDriveConfig(
  scope: ChannelAccountScope,
  cfg: Record<string, unknown>,
): void {
  driveConfigs.set(key(scope), cfg as OpenClawConfig);
}

/** The drive-time cfg registered for the account, or an empty one. */
export function getChannelDriveConfig(scope: ChannelAccountScope): OpenClawConfig {
  return driveConfigs.get(key(scope)) ?? ({} as OpenClawConfig);
}

/**
 * Reads the adapter off a loaded plugin object. `messageActions` is the shared
 * contract's slot; `actions` is upstream's own spelling, accepted so a vertical
 * ported straight from OpenClaw needs no rename.
 */
export function readPluginMessageActions(
  plugin: Record<string, unknown> | undefined,
): ChannelMessageActionAdapter | undefined {
  const candidate = plugin?.["messageActions"] ?? plugin?.["actions"];
  if (candidate === null || typeof candidate !== "object") return undefined;
  const adapter = candidate as ChannelMessageActionAdapter;
  return typeof adapter.describeMessageTool === "function" ? adapter : undefined;
}

/**
 * The vertical's outbound surface, narrowed to what core reads when it decides
 * who renders a portable `presentation`.
 *
 * Core flattens a presentation into fallback text unless the plugin's outbound
 * offers a send slot (`hasCorePresentationDelivery`). The Hub posts through
 * `outbound.sendText` for every channel, so that probe alone would claim native
 * rendering for verticals whose `sendText` ignores `presentation` — and their
 * charts and tables would reach the conversation as nothing at all. The declared
 * `presentationCapabilities` is the vertical's own claim that it renders one, so
 * it gates the surface: Slack renders (`presentation-outbound.ts`), every other
 * vertical keeps receiving core's fallback text.
 */
export function readPluginPresentationOutbound(
  plugin: Record<string, unknown> | undefined,
): ChannelOutboundAdapter | undefined {
  const candidate = plugin?.["outbound"];
  if (candidate === null || typeof candidate !== "object") return undefined;
  const outbound = candidate as ChannelOutboundAdapter;
  if (outbound.presentationCapabilities?.supported !== true) return undefined;
  if (typeof outbound.sendText !== "function") return undefined;
  // Only the two members core reads: the Hub owns delivery, and handing core a
  // live `sendPayload`/`sendMedia` would offer it a second way to post.
  return {
    presentationCapabilities: outbound.presentationCapabilities,
    sendText: outbound.sendText,
  };
}

/** Registers a loaded vertical's action adapter for one account. */
export function registerChannelMessageActions(
  scope: ChannelAccountScope,
  plugin: Record<string, unknown> | undefined,
): void {
  const outbound = readPluginPresentationOutbound(plugin);
  if (outbound === undefined) presentationOutbounds.delete(key(scope));
  else presentationOutbounds.set(key(scope), outbound);
  const actions = readPluginMessageActions(plugin);
  if (actions === undefined) {
    registry.delete(key(scope));
    return;
  }
  registry.set(key(scope), actions);
}

/** Drops an account's adapter when its vertical is disposed. */
export function clearChannelMessageActions(scope: ChannelAccountScope): void {
  registry.delete(key(scope));
  presentationOutbounds.delete(key(scope));
  driveConfigs.delete(key(scope));
}

/** The adapter registered for this account, if the vertical ships one. */
export function getChannelMessageActions(
  scope: ChannelAccountScope,
): ChannelMessageActionAdapter | undefined {
  return registry.get(key(scope));
}

const CORE_ACTION_NAMES = new Set<string>(CHANNEL_MESSAGE_ACTION_NAMES);

/**
 * Actions the Hub refuses to advertise or run, whatever the vertical says.
 *
 * A Channel reply capability is bound to one conversation, and every action the
 * Hub runs is addressed by that binding. These two carry a target mode of
 * `none` (`message-action-spec.ts`): their subject is a resource id, not a
 * conversation, so nothing in the call ties them to the bound thread. Slack
 * `download-file` would fetch any file id the bot token can see and `search`
 * would read the whole workspace, both from a capability issued for one
 * channel. Binding them needs a Hub fact that does not exist — the inbound
 * plane carries no file ids and no search scope — so they are dropped from
 * discovery and refused at execution instead of being half-authorized.
 */
export const CONVERSATION_UNBINDABLE_ACTIONS: readonly string[] = ["download-file", "search"];

/**
 * True when the Hub can address this action with the capability's binding.
 *
 * Every action with a `to`/`channelId` target mode is bound by construction —
 * the Hub overwrites the target. A `none`-target action is bound only when its
 * subject is the account itself (`emoji-list`, `sticker-search`, `member-info`);
 * one that names a foreign resource is refused.
 */
export function isConversationBindableAction(action: string): boolean {
  if (CONVERSATION_UNBINDABLE_ACTIONS.includes(action)) return false;
  return Object.hasOwn(MESSAGE_ACTION_TARGET_MODE, action) || action === "send";
}

/**
 * Actions the Hub can actually execute for one account: `send` always (the
 * outbound seam owns it), plus every advertised action the registered adapter
 * declines to refuse. `supportsAction` is upstream's cheap decline hook, so an
 * adapter that omits it is taken at its word for the actions it advertises.
 */
export function resolveExecutableActions(
  scope: ChannelAccountScope,
  advertised: readonly string[],
): string[] {
  const actions = getChannelMessageActions(scope);
  if (actions === undefined) return ["send"];
  const supports = actions.supportsAction;
  const executable = advertised.filter((action) => {
    if (action === "send") return true;
    if (!CORE_ACTION_NAMES.has(action)) return false;
    if (!isConversationBindableAction(action)) return false;
    if (typeof actions.handleAction !== "function") return false;
    return supports === undefined || supports({ action: action as ChannelMessageActionName });
  });
  return executable.includes("send") ? executable : ["send", ...executable];
}

/**
 * The account-scoped plugin object core discovers and dispatches through.
 *
 * `outbound` carries the vertical's presentation surface when it has one, so a
 * `send` that names a `presentation` keeps it all the way to the post seam
 * instead of being materialized into fallback text before the vertical sees it
 * (`hasCorePresentationDelivery`). `deliveryMode` is deliberately not carried:
 * the Hub is the delivery owner for every account, whatever the vertical would
 * tell a host that ran its own gateway.
 *
 * `providerOwnedReadGates` is stripped on the way in. Upstream lets a plugin
 * claim that its provider gateway enforces conversation reads itself, and
 * core's dispatcher then skips its own chokepoint
 * (`enforceMessageActionConversationReadGate` returns early). Fusion runs no
 * gateway: Slack, Discord, Telegram and Feishu all set the flag, so honouring
 * it would leave `read`/`edit`/`delete`/`pin`/`member-info` with no authority
 * check at all and a model-supplied `channelId` would reach the vertical. The
 * registration stays `bundled`, so the host gate runs in its bundled mode and
 * the verticals' own target aliases still resolve.
 */
function corePlugin(scope: ChannelAccountScope): CoreChannelPlugin {
  const outbound = presentationOutbounds.get(key(scope));
  const rendering = outbound === undefined ? {} : { outbound };
  const actions = getChannelMessageActions(scope);
  if (actions === undefined) return { id: scope.channel, ...rendering };
  const { providerOwnedReadGates: _hostEnforced, ...hostGated } = actions;
  return { id: scope.channel, actions: hostGated, ...rendering };
}

/** Scopes core's plugin discovery to the account's plugin for the duration of a call. */
export function withChannelMessageToolPlugin<T>(
  scope: ChannelAccountScope,
  run: (catalog: PreparedMessageToolCatalog) => T,
): T {
  const plugin = corePlugin(scope);
  return runWithChannelMessageToolPlugins([plugin], () =>
    run(buildPreparedMessageToolCatalog([plugin])),
  );
}

/** One platform message the Hub posts: text, or one staged file. */
export interface HubOutboundSendParams {
  to: string;
  text: string;
  /** A staged file to post natively. The reply body is its own platform
   * message, so a media post carries no text. */
  media?: StagedChannelMedia | undefined;
  /** The portable presentation this message renders, for a vertical that
   * renders one natively. `text` stays the fallback rendering. */
  presentation?: MessagePresentation | undefined;
  threadId?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface HubOutboundSendResult {
  ok: boolean;
  externalMessageId?: string | undefined;
  error?: string | undefined;
  /** The vertical's G11 fact: false when it posted the oversize notice instead. */
  mediaPosted?: boolean | undefined;
}

/** The Hub's outbound seam, expressed as core's durable sender. */
export type HubOutboundSend = (params: HubOutboundSendParams) => Promise<HubOutboundSendResult>;

/** Everything one message-action call needs from the Hub. */
export interface ChannelMessageActionRequest extends ChannelAccountScope {
  action: string;
  params: Record<string, unknown>;
  /** The conversation the Hub bound this capability to. */
  conversation: { to: string; threadId?: string };
  /** The Hub's record-before-post outbound seam, used only for `send`. */
  send: HubOutboundSend;
  /** Turns the send's media params into local files (slice 11b). A `send`
   * carrying media without one fails loudly: silently dropping the file would
   * look like a delivered attachment to the agent. */
  stageMedia?: ChannelMediaStager;
  /** The external sender whose inbound message the capability was issued for.
   * Ported executors that enforce channel-local trust (Feishu's read policy,
   * Discord's guild-admin actions) read it as `requesterSenderId`; without it
   * they either fail closed or act with no requester at all. */
  requesterSenderId?: string | undefined;
  /** The channel-native id of the inbound message the turn is answering. The
   * ported runner reads it as the CURRENT message: `react` with no `messageId`
   * targets it, and a delegated mutation of it is server-owned, so it needs no
   * stored provider observation. */
  requesterMessageId?: string | undefined;
  agentId?: string;
  sessionId?: string;
  idempotencyKey?: string;
}

/** One posted platform message. `mediaPosted` is the vertical's G11 fact: false
 * when it refused the file and posted the oversize notice through its text path
 * instead, so the message the agent asked for did not carry the attachment. */
export interface ChannelDeliveryFact {
  ok: boolean;
  messageId?: string | undefined;
  mediaPosted?: boolean | undefined;
  error?: string | undefined;
}

/** The structured outcome the `message` tool reports back to the agent. */
export interface ChannelMessageActionOutcome {
  ok: boolean;
  action: string;
  handledBy: string;
  /** Native message id when the action produced or addressed one. */
  messageId?: string;
  /** Set when the platform accepted part of the work before failing. */
  sentBeforeError?: boolean;
  /** One entry per platform message a `send` produced (text, then each file). */
  deliveries?: ChannelDeliveryFact[];
  error?: string;
  payload: unknown;
  /** The upstream tool result, when the vertical returned one. */
  toolText?: string;
}

/**
 * Runs one message action on the production path: core normalizes the params,
 * resolves the target and thread, then either dispatches to the vertical's
 * `handleAction` or sends through the Hub's seam.
 */
export async function runChannelMessageAction(
  request: ChannelMessageActionRequest,
): Promise<ChannelMessageActionOutcome> {
  if (!isConversationBindableAction(request.action)) {
    return unbindableAction(request.action);
  }
  const plugin = corePlugin(request);
  const sender: CoreOutboundSender = {
    sendMessage: async (params) => await hubSendMessage(request, params),
    sendPoll: async () => {
      throw new Error("Poll delivery has no Hub outbound seam yet.");
    },
  };
  // All three scopes are per call, never per process. One Hub serves many
  // accounts and organizations, so two tool calls are routinely in flight
  // together; a process-global plugin list, sender or media stager would let the
  // second call post into the first call's conversation, read files under the
  // first call's Project root, and then uninstall its seam.
  const run = async () =>
    await runWithChannelMessageToolPlugins(
      [plugin],
      async () =>
        await runWithCoreOutboundSender(sender, async () =>
          projectOutcome(await runMessageAction(messageActionInput(request))),
        ),
    );
  return request.stageMedia === undefined
    ? await run()
    : await runWithChannelMediaStager(request.stageMedia, run);
}

/** The structured refusal for an action the capability's binding cannot address
 * (`CONVERSATION_UNBINDABLE_ACTIONS`). It never reaches the vertical. */
function unbindableAction(action: string): ChannelMessageActionOutcome {
  const error = `${action} addresses a resource outside this conversation, so the Hub does not run it`;
  return {
    ok: false,
    action,
    handledBy: "hub",
    error,
    payload: { ok: false, status: "unbindable_action", action, reason: error },
  };
}

/** The ported runner's input for one call. Channel, account, target and thread
 * come from the Hub's binding, never from the model's params. */
function messageActionInput(
  request: ChannelMessageActionRequest,
): Parameters<typeof runMessageAction>[0] {
  const toolContext: ChannelThreadingToolContext = {
    currentChannelProvider: request.channel,
    currentChannelId: request.conversation.to,
    currentMessagingTarget: request.conversation.to,
    ...(request.conversation.threadId === undefined
      ? {}
      : { currentThreadTs: request.conversation.threadId }),
    ...(request.requesterMessageId === undefined
      ? {}
      : { currentMessageId: request.requesterMessageId }),
  };
  return {
    cfg: getChannelDriveConfig(request),
    action: request.action as ChannelMessageActionName,
    actionOrigin: "message-tool",
    params: boundParams(request),
    defaultAccountId: request.accountId,
    requesterAccountId: request.accountId,
    ...(request.requesterSenderId === undefined
      ? {}
      : { requesterSenderId: request.requesterSenderId }),
    conversationReadOrigin: "delegated",
    // The Hub owns delivery: the ledger row, the idempotency key and the
    // receipt are all written around `request.send`. Upstream's own knob for
    // "the host owns queueing" keeps a vertical's provider-native `send`
    // handler from posting behind the ledger's back (Telegram declines
    // `prepareSendPayload` for a plain send, which would otherwise route the
    // message straight into `handleAction`).
    forceCoreDelivery: true,
    toolContext,
    ...(request.agentId === undefined ? {} : { agentId: request.agentId }),
    ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
  };
}

/**
 * The runner's params: the model's, with every conversation fact overwritten by
 * the Hub's binding.
 *
 * The thread key is WRITTEN OR DELETED, never left alone. A capability bound at
 * the conversation root used to pass a model-supplied `threadId` straight
 * through, so a Telegram topic id the capability was never bound to decided
 * where the action landed.
 */
function boundParams(request: ChannelMessageActionRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...request.params,
    channel: request.channel,
    accountId: request.accountId,
    target: request.conversation.to,
  };
  if (request.conversation.threadId === undefined) delete params["threadId"];
  else params["threadId"] = request.conversation.threadId;
  if (request.idempotencyKey !== undefined) params["idempotencyKey"] = request.idempotencyKey;
  return params;
}

/**
 * The media sources one `send` carries, in the order the model wrote them.
 *
 * Core's send payload has already merged `media`, `mediaUrls` and
 * `attachments[].media` into one de-duplicated `mediaUrls` list and kept the
 * per-file name/mime on `payload.attachments`; inline `buffer` bytes stay on the
 * params because they never had a URL. Reading both back here keeps this the one
 * place that decides what a send's files are.
 */
function collectOutboundMedia(params: MessageSendParams): ChannelMediaSource[] {
  const asVoice = params["asVoice"] === true ? { asVoice: true } : {};
  const metadata = readAttachmentMetadata(params);
  const sources: ChannelMediaSource[] = [];
  for (const media of readMediaUrls(params)) {
    sources.push({ media, ...metadata.get(media), ...asVoice });
  }
  const buffer = typeof params["buffer"] === "string" ? params["buffer"].trim() : "";
  if (buffer !== "") {
    sources.push({
      buffer,
      ...(typeof params["filename"] === "string" ? { fileName: params["filename"] } : {}),
      ...(typeof params["contentType"] === "string" ? { mimeType: params["contentType"] } : {}),
      ...asVoice,
    });
  }
  return sources;
}

/** The send's media list: the merged `mediaUrls`, or the single `mediaUrl`. */
function readMediaUrls(params: MessageSendParams): string[] {
  const many = params["mediaUrls"];
  if (Array.isArray(many)) {
    return many.filter((url): url is string => typeof url === "string" && url.trim() !== "");
  }
  const one = params["mediaUrl"];
  return typeof one === "string" && one.trim() !== "" ? [one] : [];
}

/** Per-file name and mime, keyed by the media source they were written against. */
function readAttachmentMetadata(
  params: MessageSendParams,
): Map<string, { fileName?: string; mimeType?: string }> {
  const payload = Array.isArray(params["payloads"]) ? params["payloads"][0] : undefined;
  const attachments = (payload as { attachments?: unknown } | undefined)?.attachments;
  const metadata = new Map<string, { fileName?: string; mimeType?: string }>();
  if (!Array.isArray(attachments)) return metadata;
  for (const entry of attachments) {
    const attachment = entry as { path?: unknown; name?: unknown; mimeType?: unknown };
    if (typeof attachment.path !== "string") continue;
    metadata.set(attachment.path, {
      ...(typeof attachment.name === "string" ? { fileName: attachment.name } : {}),
      ...(typeof attachment.mimeType === "string" ? { mimeType: attachment.mimeType } : {}),
    });
  }
  return metadata;
}

/** Core's send boundary, backed by the Hub's record-before-post outbound seam. */
async function hubSendMessage(
  request: ChannelMessageActionRequest,
  params: MessageSendParams,
): Promise<MessageSendResult> {
  const threadId =
    params.threadId === undefined || params.threadId === null
      ? request.conversation.threadId
      : String(params.threadId);
  const media = collectOutboundMedia(params);
  const base = {
    channel: request.channel,
    to: params.to,
    via: "direct" as const,
    mediaUrl: media[0]?.media ?? null,
    ...(media.length > 0
      ? { mediaUrls: media.map((source) => source.media ?? "buffer").filter(Boolean) }
      : {}),
  };
  const post = async (one: Omit<HubOutboundSendParams, "to" | "threadId">) =>
    await request.send({
      to: params.to,
      ...one,
      ...(threadId === undefined ? {} : { threadId }),
      ...(params.idempotencyKey === undefined ? {} : { idempotencyKey: params.idempotencyKey }),
    });
  const presentation = rendersPresentation(request) ? readSendPresentation(params) : undefined;
  const outcomes = await postSendParts({
    request,
    text: params.content,
    media,
    post,
    ...(presentation === undefined ? {} : { presentation }),
  });
  return { ...base, ...summarizeSendOutcomes(outcomes) };
}

/** True for a value shaped like core's portable presentation. */
function isMessagePresentation(value: unknown): value is MessagePresentation {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as { blocks?: unknown }).blocks)
  );
}

/** True when this account's vertical renders a portable presentation itself. */
function rendersPresentation(scope: ChannelAccountScope): boolean {
  return presentationOutbounds.has(key(scope));
}

/**
 * The presentation core kept on the send payload.
 *
 * Core normalizes the model's `presentation` onto `payloads[0]` and leaves it
 * there even for a channel that cannot render it — the flattening it does for
 * those rewrites `content` and the payload's `text`, not the blocks. So the
 * blocks are only worth forwarding when the account's vertical declared it
 * renders them; otherwise `content` already carries the whole message.
 */
function readSendPresentation(params: MessageSendParams): MessagePresentation | undefined {
  const payload = Array.isArray(params["payloads"]) ? params["payloads"][0] : undefined;
  const presentation = (payload as { presentation?: unknown } | undefined)?.presentation;
  return isMessagePresentation(presentation) ? presentation : undefined;
}

/** One platform message per part, in order, stopping at the first failure. */
async function postSendParts(args: {
  request: ChannelMessageActionRequest;
  text: string;
  media: readonly ChannelMediaSource[];
  presentation?: MessagePresentation;
  post: (one: Omit<HubOutboundSendParams, "to" | "threadId">) => Promise<HubOutboundSendResult>;
}): Promise<HubOutboundSendResult[]> {
  const outcomes: HubOutboundSendResult[] = [];
  // The text is its own platform message: the Hub's media seam posts one file
  // per call and carries no caption, so folding the body into the first
  // attachment would need a widened vertical contract (open in the ledger). The
  // presentation rides that message — a send that is only blocks has no text.
  if (args.text.trim() !== "" || args.media.length === 0 || args.presentation !== undefined) {
    outcomes.push(
      await args.post({
        text: args.text,
        ...(args.presentation === undefined ? {} : { presentation: args.presentation }),
      }),
    );
    if (outcomes[0]?.ok !== true) return outcomes;
  }
  for (const source of args.media) {
    const outcome = await postOneFile(args.request, source, args.post);
    outcomes.push(outcome);
    if (!outcome.ok) break;
  }
  return outcomes;
}

/** Stages one media source and posts it; staged bytes are released either way. */
async function postOneFile(
  request: ChannelMessageActionRequest,
  source: ChannelMediaSource,
  post: (one: Omit<HubOutboundSendParams, "to" | "threadId">) => Promise<HubOutboundSendResult>,
): Promise<HubOutboundSendResult> {
  if (request.stageMedia === undefined) {
    return { ok: false, error: "this session cannot send files: no media stager is installed" };
  }
  let staged: StagedChannelMedia;
  try {
    staged = await request.stageMedia(source);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  try {
    return await post({ text: "", media: staged });
  } finally {
    await staged.release?.().catch(() => undefined);
  }
}

/** Upstream's delivery vocabulary for a send that produced several messages. */
function summarizeSendOutcomes(
  outcomes: readonly HubOutboundSendResult[],
): Pick<
  MessageSendResult,
  "deliveryStatus" | "error" | "sentBeforeError" | "result" | "payloadOutcomes"
> {
  const sent = outcomes.filter((outcome) => outcome.ok);
  const failed = outcomes.find((outcome) => !outcome.ok);
  const messageId = sent[0]?.externalMessageId ?? "";
  if (failed === undefined) {
    return { deliveryStatus: "sent", result: { messageId }, payloadOutcomes: [...outcomes] };
  }
  const error = failed.error ?? "the channel post failed";
  return sent.length === 0
    ? { deliveryStatus: "failed", error, payloadOutcomes: [...outcomes] }
    : {
        deliveryStatus: "partial_failed",
        error,
        sentBeforeError: true,
        result: { messageId },
        payloadOutcomes: [...outcomes],
      };
}

/**
 * Maps upstream's result union onto the tool's structured content. Delivered,
 * partial and unknown outcomes all come from `resolveMessageActionOutcome`, so
 * the Hub adds no status of its own.
 */
function projectOutcome(result: MessageActionResult): ChannelMessageActionOutcome {
  const outcome = resolveMessageActionOutcome(result);
  const toolResult = getToolResult(result);
  const toolText = toolResult?.content
    .map((entry) => (entry.type === "text" ? entry.text : ""))
    .filter(Boolean)
    .join("\n");
  const messageId = resolveMessageActionMessageId(result.payload);
  const deliveries = readDeliveryFacts(result);
  return {
    ok: outcome.ok,
    action: result.action,
    handledBy: result.handledBy,
    ...(messageId === undefined ? {} : { messageId }),
    ...(deliveries.length === 0 ? {} : { deliveries }),
    ...(outcome.ok ? {} : { error: redactSensitiveText(outcome.error) }),
    ...(!outcome.ok && outcome.sentBeforeError === true ? { sentBeforeError: true } : {}),
    payload: result.payload,
    ...(toolText ? { toolText } : {}),
  };
}

/** The per-message receipts `hubSendMessage` recorded, when the action sent. */
function readDeliveryFacts(result: MessageActionResult): ChannelDeliveryFact[] {
  const outcomes = result.kind === "send" ? result.sendResult?.payloadOutcomes : undefined;
  if (!Array.isArray(outcomes)) return [];
  const facts: ChannelDeliveryFact[] = [];
  for (const entry of outcomes) {
    const outcome = entry as HubOutboundSendResult;
    const fact: ChannelDeliveryFact = { ok: outcome.ok === true };
    if (outcome.externalMessageId !== undefined) fact.messageId = outcome.externalMessageId;
    if (outcome.mediaPosted !== undefined) fact.mediaPosted = outcome.mediaPosted;
    if (outcome.error !== undefined) fact.error = redactSensitiveText(outcome.error);
    facts.push(fact);
  }
  return facts;
}
