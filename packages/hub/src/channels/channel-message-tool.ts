// The `message` tool's input schema, generated from the ported OpenClaw
// message-tool layer (`@getpaseo/channels-core`) instead of hand-written JSON.
//
// Upstream builds one flat schema per turn from the plugin's
// `describeMessageTool` discovery hook, scoped to the actions and capabilities
// that channel/account actually advertises. Fusion keeps that pipeline and
// supplies the discovery hooks for the two in-repo verticals here; the Hub owns
// authority, so the resulting schema is trimmed at the Fusion boundary
// (D-HUB-MSGTOOL-001) before it reaches an agent.
//
// Advertising an action is not a claim that Fusion can run it. `send` always
// reaches the outbound seam; every other action reaches the vertical's ported
// `ChannelMessageActionAdapter` when it registered one for that account
// (`message-actions.ts`), and the tool answers the rest with a structured
// `unsupported_action` result.

import {
  buildMessageToolSchema,
  buildMessageToolDescription,
  resolveMessageToolActionSchemaActions,
} from "@getpaseo/channels-core/agents/tools/message-tool-discovery";
import {
  buildPreparedMessageToolCatalog,
  type PreparedMessageToolCatalog,
} from "@getpaseo/channels-core/channels/plugins/message-action-discovery.host-adapter";
import type {
  ChannelMessageToolDiscovery,
  ChannelPlugin,
  OpenClawConfig,
} from "@getpaseo/channels-core/channels/plugins/types.public.host-adapter";
import type { MediaChannel } from "@getpaseo/channels-shared";
import type { SupportedChannelName } from "./plane/types.js";
import {
  getChannelDriveConfig,
  getChannelMessageActions,
  isConversationBindableAction,
  resolveExecutableActions,
  type ChannelAccountScope,
} from "./message-actions.js";

/** Actions the Hub can execute without any channel adapter: the outbound seam. */
export const EXECUTABLE_MESSAGE_ACTIONS: readonly string[] = ["send"];

/**
 * Schema keys excluded at the Fusion boundary (D-HUB-MSGTOOL-001).
 *
 * `gatewayUrl`/`gatewayToken`/`timeoutMs` address the OpenClaw Gateway, which
 * Fusion does not run; a model must never pick the Hub's endpoint or
 * credentials. `channel`/`accountId`/`target`/`targets` pick a destination and
 * `dryRun` decides whether the message is posted at all, and a Channel reply
 * capability is bound to exactly one account and conversation — accepting them
 * would hand over authority the capability does not carry. They are stripped
 * from the schema AND refused when a call carries one
 * (`readHostOnlyMessageToolFields`).
 */
export const HOST_ONLY_MESSAGE_TOOL_FIELDS: readonly string[] = [
  "gatewayUrl",
  "gatewayToken",
  "timeoutMs",
  "channel",
  "accountId",
  "target",
  "targets",
  "dryRun",
];

/**
 * The host-only keys the model actually sent, if any.
 *
 * Removing them from the JSON Schema is advertising, not enforcement: nothing
 * in MCP stops a model from sending a property the schema never offered, and
 * every one of these changes where the message goes or whether it is sent at
 * all. `dryRun` was the sharp one — core's runner reads it straight off the
 * params (`message-action-runner.ts`), so a model could make the Hub record a
 * delivery, report success and post nothing.
 */
export function readHostOnlyMessageToolFields(args: Record<string, unknown>): string[] {
  return HOST_ONLY_MESSAGE_TOOL_FIELDS.filter((field) => Object.hasOwn(args, field));
}

/**
 * The discovery hook each in-repo vertical advertises. Action names come from
 * the canonical upstream vocabulary; the sets mirror what the Slack and
 * Telegram extensions declare at baseline `5d8067a4483`.
 */
const CHANNEL_MESSAGE_TOOL_DISCOVERY: Record<SupportedChannelName, ChannelMessageToolDiscovery> = {
  slack: {
    actions: [
      "send",
      "react",
      "reactions",
      "read",
      "edit",
      "delete",
      "pin",
      "unpin",
      "list-pins",
      "member-info",
      "emoji-list",
      // `conversation-open` opens or reuses a (group) DM and answers with its
      // target; the vertical implements it (`slack/src/message-actions.ts`).
      "conversation-open",
      "upload-file",
    ],
    capabilities: ["presentation"],
  },
  telegram: {
    actions: [
      "send",
      "poll",
      "react",
      "edit",
      "delete",
      "emoji-list",
      "sticker",
      "sticker-search",
      "topic-create",
      "topic-edit",
    ],
    capabilities: ["presentation"],
  },
  // Discord gates most of its vocabulary on per-account `actions` toggles
  // (`channel-actions.ts` describeDiscordMessageTool), so the pre-adapter
  // fallback lists only the default-on core; the registered adapter replaces it
  // with the account's real set as soon as the vertical loads.
  discord: {
    actions: [
      "send",
      "react",
      "reactions",
      "read",
      "edit",
      "delete",
      "pin",
      "unpin",
      "list-pins",
      "upload-file",
      "emoji-list",
      "member-info",
      "thread-create",
      "thread-list",
      "thread-reply",
    ],
    capabilities: ["presentation"],
  },
  // Google Chat's whole message surface: the vertical renders no card, so it
  // advertises no `presentation` capability (`channel-actions.ts`).
  googlechat: { actions: ["send", "edit", "delete"], capabilities: [] },
  // Feishu gates `react`/`reactions` on the account's `actions.reactions`
  // toggle, so the pre-adapter fallback lists only the always-on set; the
  // registered adapter replaces it with the account's real set at load.
  feishu: {
    actions: [
      "send",
      "thread-reply",
      "read",
      "edit",
      "pin",
      "unpin",
      "list-pins",
      "member-info",
      "channel-info",
    ],
    capabilities: ["presentation"],
  },
  // The Zalo Bot API has exactly two message endpoints (`sendMessage`,
  // `sendPhoto`); there is nothing else to advertise.
  zalo: { actions: ["send"], capabilities: [] },
  // Zalo Personal's `messageActions` is `react` only (`ZALOUSER_MESSAGE_ACTIONS`);
  // `send` is the Hub's own outbound seam, as on every channel.
  zalouser: { actions: ["send", "react"], capabilities: [] },
};

/**
 * The channels with a native outbound file-upload path, so `message` accepts
 * media params at all. Google Chat's upload is user-OAuth
 * only, Feishu's is omitted from the port, and the Zalo Bot API has no upload
 * endpoint — offering the tool there would advertise a delivery that always
 * fails. The set is pinned to `@getpaseo/channels-shared`'s `MediaChannel`,
 * which owns the per-channel size caps.
 */
export function isMediaChannel(channel: SupportedChannelName): channel is MediaChannel {
  return channel === "slack" || channel === "telegram" || channel === "discord";
}

/**
 * The plugin core discovers through. When the loaded vertical registered its
 * ported adapter for this account, that adapter owns discovery — its
 * `describeMessageTool` is the upstream source of truth for actions, capabilities
 * and schema contributions. The static table below is the pre-adapter fallback,
 * kept so an account whose vertical has not landed yet still advertises the
 * channel's action vocabulary.
 */
function channelPlugin(channel: SupportedChannelName, scope?: ChannelAccountScope): ChannelPlugin {
  const registered = scope === undefined ? undefined : getChannelMessageActions(scope);
  return {
    id: channel,
    actions: registered ?? { describeMessageTool: () => CHANNEL_MESSAGE_TOOL_DISCOVERY[channel] },
  };
}

// One catalog per channel account: the capability binds one account on one
// channel, so cross-channel action discovery has nothing to add. Accounts that
// registered an adapter are cached separately from the pre-adapter fallback.
const CATALOGS = new Map<string, PreparedMessageToolCatalog>();

function catalogFor(
  channel: SupportedChannelName,
  scope?: ChannelAccountScope,
): PreparedMessageToolCatalog {
  const registered = scope === undefined ? undefined : getChannelMessageActions(scope);
  const key = registered === undefined || scope === undefined ? channel : catalogKey(scope);
  const cached = CATALOGS.get(key);
  if (cached !== undefined) return cached;
  const catalog = buildPreparedMessageToolCatalog([channelPlugin(channel, scope)]);
  CATALOGS.set(key, catalog);
  return catalog;
}

function catalogKey(scope: ChannelAccountScope): string {
  return `${scope.organizationId}:${scope.channel}:${scope.accountId}`;
}

/** Drops the cached catalog for an account whose adapter registration changed. */
export function forgetChannelMessageToolCatalog(scope: ChannelAccountScope): void {
  CATALOGS.delete(catalogKey(scope));
}

/**
 * What discovery is asked about one account (D-W4-02).
 *
 * A vertical's `describeMessageTool` reads the account off `cfg`, not off the
 * plugin object, and each one refuses differently when it finds nothing there:
 * Slack enumerates the configured accounts and advertises an empty set when
 * `cfg` carries none, while Telegram falls back to an unscoped, default-on
 * gate. Discovery ran with an empty `cfg` until Wave 4, so Slack advertised
 * only `send` and the tool refused `react`/`edit`/`pin` before they could reach
 * the vertical, while Telegram's fallback masked the same bug.
 *
 * The cfg is the drive-time one the supervisor resolved for the account — the
 * same object `runChannelMessageAction` hands the runner. It carries exactly
 * one account, the bound one, so cfg-scoped discovery is already account-scoped
 * without naming the account and forcing every vertical onto its strict path.
 */
function discoveryParams(
  channel: SupportedChannelName,
  scope?: ChannelAccountScope,
): {
  cfg: OpenClawConfig;
  currentChannelProvider: SupportedChannelName;
  preparedMessageToolCatalog: PreparedMessageToolCatalog;
} {
  return {
    cfg: scope === undefined ? ({} as OpenClawConfig) : getChannelDriveConfig(scope),
    currentChannelProvider: channel,
    preparedMessageToolCatalog: catalogFor(channel, scope),
  };
}

/**
 * Actions the tool advertises for one account, in the channel's own order.
 *
 * A vertical advertises what its provider implements; the Hub advertises what a
 * capability bound to one conversation may ask for, so an action the binding
 * cannot address is dropped here rather than refused after the model has
 * written the call (`CONVERSATION_UNBINDABLE_ACTIONS`).
 */
export function listChannelMessageToolActions(
  channel: SupportedChannelName,
  scope?: ChannelAccountScope,
): string[] {
  return resolveMessageToolActionSchemaActions(discoveryParams(channel, scope)).filter(
    isConversationBindableAction,
  );
}

/**
 * Actions the Hub can actually run for this account: `send` through the outbound
 * seam, plus whatever the registered adapter handles. Everything else the schema
 * advertises is refused with a structured `unsupported_action` result.
 */
export function listExecutableMessageActions(
  channel: SupportedChannelName,
  scope?: ChannelAccountScope,
): string[] {
  if (scope === undefined) return [...EXECUTABLE_MESSAGE_ACTIONS];
  return resolveExecutableActions(scope, listChannelMessageToolActions(channel, scope));
}

/** True when the exposed schema offers this action and the Hub can run it. */
export function isExecutableMessageAction(
  action: string,
  channel?: SupportedChannelName,
  scope?: ChannelAccountScope,
): boolean {
  if (channel === undefined || scope === undefined) {
    return EXECUTABLE_MESSAGE_ACTIONS.includes(action);
  }
  return listExecutableMessageActions(channel, scope).includes(action);
}

/**
 * Fusion-owned properties merged into the generated schema (D-HUB-MSGTOOL-002).
 *
 * `text` is Paseo's pre-existing alias for the canonical `message` field and
 * stays until its consumers migrate. `idempotencyKey` and `final` are Hub
 * delivery contracts: upstream derives an idempotency key inside its execution
 * layer and expresses progress/terminal through source-reply policy, neither of
 * which is ported yet.
 */
const FUSION_MESSAGE_TOOL_FIELDS: Record<string, unknown> = {
  text: {
    type: "string",
    minLength: 1,
    description: "Alias for message; supply one or the other, not two different texts.",
  },
  idempotencyKey: {
    type: "string",
    minLength: 1,
    maxLength: 256,
    description: "Scoped to this capability; makes retries idempotent across requests.",
  },
  final: {
    type: "boolean",
    description: "false = progress update; true or omitted = the completed reply.",
  },
};

interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Builds the account-scoped `message` input schema as plain JSON Schema.
 *
 * TypeBox schemas are JSON objects carrying non-enumerable symbol markers; the
 * round trip drops the markers so the MCP wire payload stays plain data.
 */
export function buildChannelMessageToolSchema(
  channel: SupportedChannelName,
  scope?: ChannelAccountScope,
): JsonSchemaObject {
  const actions = listChannelMessageToolActions(channel, scope);
  const schema = buildMessageToolSchema(discoveryParams(channel, scope), actions);
  const plain = JSON.parse(JSON.stringify(schema)) as JsonSchemaObject;
  for (const field of HOST_ONLY_MESSAGE_TOOL_FIELDS) {
    delete plain.properties[field];
  }
  plain.required = (plain.required ?? []).filter(
    (name) => !HOST_ONLY_MESSAGE_TOOL_FIELDS.includes(name),
  );
  Object.assign(plain.properties, FUSION_MESSAGE_TOOL_FIELDS);
  return plain;
}

/** The upstream description line, plus Fusion's fixed-conversation contract. */
export function buildChannelMessageToolDescription(
  channel: SupportedChannelName,
  scope?: ChannelAccountScope,
): string {
  return [
    buildMessageToolDescription(listChannelMessageToolActions(channel, scope)),
    "Posts into the channel thread this session was created from; the destination is fixed by the Hub.",
    "Set final=false for progress; set final=true, or omit it, for the completed reply.",
    ...(isMediaChannel(channel)
      ? [
          "Send files with this tool too: attachments:[{media:'/abs/path'}] takes one or many files of any type, media/buffer/asVoice work as documented.",
        ]
      : []),
  ].join(" ");
}
