// Authored YAML shapes for the channel control plane (implementation doc §4.3.2,
// §4.3.3, §4.3.6). These parse the files under `.paseo/channels/`; cross-reference
// validation (agents/environments/workflows/users) happens in `compile.ts`.

import { z } from "zod";
import {
  ApprovalModeSchema,
  BindingKeySchema,
  DmPolicySchema,
  EditNotificationsSchema,
  ErrorPolicySchema,
  GroupPolicySchema,
  FollowUpModeSchema,
  InlineButtonsSchema,
  isApprovalMatchPattern,
  MessageReactionSchema,
  OutboundPathSchema,
  ReplyAnchorSchema,
  ReactionNotificationsSchema,
  RouteMatchKindSchema,
  SlackTransportModeSchema,
  DiscordTransportModeSchema,
  FeishuTransportModeSchema,
  GoogleChatTransportModeSchema,
  ZalouserTransportModeSchema,
  ZaloTransportModeSchema,
  TelegramTransportModeSchema,
  StreamingModeSchema,
  ThreadLinkSchema,
} from "./enums.js";
import type {
  BindingKey,
  DmPolicy,
  EditNotifications,
  GroupPolicy,
  FollowUpMode,
  OutboundPath,
  ReactionNotifications,
  ReplyAnchor,
  ThreadLink,
} from "./enums.js";

// --- Shared value shapes ------------------------------------------------------

/** `<channel>:<provider-id>` identity; email is `email:<address>` (§4.3.7). */
export const ChannelIdentitySchema = z.string().min(1);
export type ChannelIdentity = z.infer<typeof ChannelIdentitySchema>;

/**
 * `user:<username>` reference or a raw `<channel>:<id>` identity (§4.3.2). The
 * `user:` prefix is semantic (checked at compile), not a schema branch.
 */
export const AssignmentIdentitySchema = z.string().min(1);
export type AssignmentIdentity = z.infer<typeof AssignmentIdentitySchema>;

export const RoleAssignmentSchema = z
  .object({
    identities: z.array(AssignmentIdentitySchema).min(1),
    // Role names are free; an unknown name contributes nothing (fail-closed).
    roles: z.array(z.string().min(1)),
  })
  .strict();
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;

// Layer `defaults:` blocks are parsed WITHOUT baked-in defaults: an omitted
// key inherits from the layer below (org < account < route), and the org-layer
// effective values come from `ORG_DEFAULT_*` (§4.3.2/§4.3.6) applied exactly
// once, in the compiler's merge.

export const FollowUpSchema = z
  .object({
    mode: FollowUpModeSchema.optional(),
    ttlMinutes: z.number().int().positive().optional(),
  })
  .strict();
export type FollowUp = z.infer<typeof FollowUpSchema>;

export const InteractionDefaultsSchema = z
  .object({
    requireMention: z.boolean().optional(),
    followUp: FollowUpSchema.optional(),
  })
  .strict();
export type InteractionDefaults = z.infer<typeof InteractionDefaultsSchema>;

export const BindingDefaultsSchema = z.object({ key: BindingKeySchema.optional() }).strict();
export type BindingDefaults = z.infer<typeof BindingDefaultsSchema>;

export const ReplyDefaultsSchema = z.object({ anchor: ReplyAnchorSchema.optional() }).strict();
export type ReplyDefaults = z.infer<typeof ReplyDefaultsSchema>;

/**
 * `sync.progress` — the "the bot is working" surface, as three independent
 * leaves: `progressMessage` (a throttled relay line in the thread),
 * `typingIndicator` (the provider's native typing status: Slack's assistant
 * thread status, Telegram's `sendChatAction`), and `messageReaction` (the
 * receipt — see `MessageReactionSchema`).
 *
 * A bare boolean is the pre-group spelling and means `progressMessage` ONLY —
 * it never spoke about the other two surfaces, so they keep inheriting. That
 * keeps every already-authored revision (`sync: { progress: true }`) valid
 * without a migration.
 */
export const SyncProgressGroupSchema = z
  .object({
    progressMessage: z.boolean().optional(),
    typingIndicator: z.boolean().optional(),
    messageReaction: MessageReactionSchema,
  })
  .strict();
export type SyncProgressGroup = z.infer<typeof SyncProgressGroupSchema>;

export const SyncProgressSchema = z.union([z.boolean(), SyncProgressGroupSchema]).optional();
export type SyncProgress = z.infer<typeof SyncProgressSchema>;

/**
 * `sync.streaming` — the live-draft surface for a running turn. Both leaves
 * are upstream's (`StreamingModeSchema`, and `nativeTransport` = may the
 * vertical use its platform-native streaming transport rather than an
 * edit-in-place draft), so an OpenClaw account's `streaming:` block compiles
 * unchanged.
 *
 * Absent at every layer means the org floor, which is OFF: the turn's answer
 * is one final post. That absence is load-bearing — the compiler omits the
 * key entirely when nobody authored it, so a revision written before this
 * knob existed compiles to the exact same effective defaults it always did.
 */
export const SyncStreamingSchema = z
  .object({
    mode: StreamingModeSchema.optional(),
    nativeTransport: z.boolean().optional(),
  })
  .strict();
export type SyncStreaming = z.infer<typeof SyncStreamingSchema>;

/**
 * `sync.subagents` — the same relay knobs as `sync`, scoped to the subagent
 * (Task tool) text relayed into the thread. Off at the org floor: subagent
 * output is opt-in per route, root `sync.*` is unaffected.
 *
 * `progress` stays a plain boolean here on purpose: a subagent has no typing
 * surface of its own — the indicator and the reaction belong to the root
 * turn's conversation, so a subagent scope can only gate its relayed text.
 */
export const SyncSubagentsSchema = z
  .object({
    finalAnswers: z.boolean().optional(),
    progress: z.boolean().optional(),
    toolCalls: z.boolean().optional(),
  })
  .strict();
export type SyncSubagents = z.infer<typeof SyncSubagentsSchema>;

export const SyncDefaultsSchema = z
  .object({
    finalAnswers: z.boolean().optional(),
    progress: SyncProgressSchema,
    toolCalls: z.boolean().optional(),
    threadLink: ThreadLinkSchema.optional(),
    streaming: SyncStreamingSchema.optional(),
    subagents: SyncSubagentsSchema.optional(),
  })
  .strict();
export type SyncDefaults = z.infer<typeof SyncDefaultsSchema>;

/**
 * `outbound` — the reply-path toggle (E4/E6). `path` selects the surface the
 * agent's user-visible answer is posted through; `template` overrides the
 * injection text composed into the agent's `systemPrompt` for a `tool` path
 * (the default is the ported OpenClaw message-tool-only block). Absent at a
 * layer = inherit from the layer below; the org floor is `relay`.
 */
export const OutboundDefaultsSchema = z
  .object({
    path: OutboundPathSchema.optional(),
    template: z.string().min(1).optional(),
  })
  .strict();
export type OutboundDefaults = z.infer<typeof OutboundDefaultsSchema>;

/**
 * `access` — the upstream sender-admission knobs, authorable at every layer
 * (org < account < route) like every other `defaults:` group. Names and
 * semantics are OpenClaw's (`dmPolicy`, `groupPolicy`, `allowFrom`,
 * `groupAllowFrom`), so an account file written for OpenClaw compiles here.
 *
 * The whole group is optional at every layer, and its ABSENCE is load-bearing:
 * a revision that authored no `access:` leaf compiles to no `access` key at
 * all, and the plane then runs exactly the RBAC gate it always did. Authoring
 * one leaf turns the upstream gate on IN FRONT of the RBAC gate — both must
 * allow. There is no org floor for this group; upstream's fail-closed defaults
 * (`dmPolicy: pairing`, `groupPolicy: allowlist`) would silently deny every
 * conversation on an already-deployed revision.
 *
 * `deniedReply` is Fusion-owned and has no upstream counterpart: upstream
 * refuses silently, which stays the default (absent = say nothing).
 */
export const AccessDefaultsSchema = z
  .object({
    dmPolicy: DmPolicySchema.optional(),
    groupPolicy: GroupPolicySchema.optional(),
    /** Sender ids admitted in DMs (and in groups, unless `groupAllowFrom` is
     * set). `*` is the wildcard. */
    allowFrom: z.array(z.union([z.string().min(1), z.number()])).optional(),
    /** Sender ids admitted in group conversations; absent falls back to
     * `allowFrom` unless `groupAllowFromFallbackToAllowFrom` is false. */
    groupAllowFrom: z.array(z.union([z.string().min(1), z.number()])).optional(),
    groupAllowFromFallbackToAllowFrom: z.boolean().optional(),
    /** What to post when a sender is refused. Absent = silent, as upstream. */
    deniedReply: z.string().min(1).optional(),
  })
  .strict();
export type AccessDefaults = z.infer<typeof AccessDefaultsSchema>;

/**
 * `inbound` — what the plane does with the non-message inbound families a
 * channel delivers (reactions, edits, joins, pins, topic and poll events). None
 * of them ever starts an agent turn on its own; these leaves say whether the
 * event is recorded, and — for an edit — whether it is re-run as a message. The
 * per-kind routing table itself is code, not config
 * (`plane/inbound-kinds.ts`). Absent at a layer = inherit from the layer below.
 */
export const InboundDefaultsSchema = z
  .object({
    reactionNotifications: ReactionNotificationsSchema.optional(),
    editNotifications: EditNotificationsSchema.optional(),
  })
  .strict();
export type InboundDefaults = z.infer<typeof InboundDefaultsSchema>;

/**
 * The org-layer effective values for `defaults:` (§4.3.2/§4.3.6). The compiler
 * applies these when the org `policy.yml` omits a key; account and route
 * layers only override.
 */
export const ORG_DEFAULTS = {
  defaultRoles: [],
  interaction: {
    requireMention: true,
    followUp: { mode: "auto", ttlMinutes: 60 },
  },
  binding: { key: "thread" },
  reply: { anchor: "default" },
  outbound: { path: "relay" as const, template: null },
  // The floor is "notice nothing": a reaction or an edit is a fact about the
  // room, not a request, so neither is recorded and neither re-runs a turn.
  inbound: { reactionNotifications: "off" as const, editNotifications: "off" as const },
  sync: {
    finalAnswers: true,
    // The progress group's floor: the relay line and the native typing
    // indicator are on; the inbound-message reaction is off (it leaves an
    // artefact on the user's own message, so it stays opt-in).
    progress: {
      progressMessage: true,
      typingIndicator: true,
      messageReaction: "off",
    },
    toolCalls: false,
    threadLink: "final-only",
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  },
} as const;

// --- Approval rules (§4.3.2, §4.3.6) -------------------------------------------

/**
 * `match` is a tool class (`file`, `command.destructive`, …), a privilege
 * reference, or the `*` wildcard; `mode` is the decision; `initiatorOnly`
 * restricts approval to the thread's initiator. Rules are first-match; a
 * `*` fallback is required at the merged level (checked by the compiler).
 */
export const ApprovalRuleSchema = z
  .object({
    match: z.string().min(1).refine(isApprovalMatchPattern, {
      message: "match must be a tool class, a privilege, or the * wildcard",
    }),
    mode: ApprovalModeSchema,
    initiatorOnly: z.boolean().optional(),
  })
  .strict();
export type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;

/**
 * One inheritance layer of the defaults fold (org < account < route). Every
 * key and leaf is optional: an unset leaf inherits from the layer below, and
 * the org-layer effective values come from `ORG_DEFAULTS`, applied exactly
 * once by the compiler (§4.3.2/§4.3.6). Property types carry explicit
 * `| undefined` so zod-parsed layers assign cleanly under
 * exactOptionalPropertyTypes.
 */
export interface DefaultsLayer {
  interaction?:
    | {
        requireMention?: boolean | undefined;
        followUp?: { mode?: FollowUpMode | undefined; ttlMinutes?: number | undefined } | undefined;
      }
    | undefined;
  binding?: { key?: BindingKey | undefined } | undefined;
  reply?: { anchor?: ReplyAnchor | undefined } | undefined;
  outbound?: { path?: OutboundPath | undefined; template?: string | undefined } | undefined;
  inbound?:
    | {
        reactionNotifications?: ReactionNotifications | undefined;
        editNotifications?: EditNotifications | undefined;
      }
    | undefined;
  access?:
    | {
        dmPolicy?: DmPolicy | undefined;
        groupPolicy?: GroupPolicy | undefined;
        allowFrom?: readonly (string | number)[] | undefined;
        groupAllowFrom?: readonly (string | number)[] | undefined;
        groupAllowFromFallbackToAllowFrom?: boolean | undefined;
        deniedReply?: string | undefined;
      }
    | undefined;
  sync?:
    | {
        finalAnswers?: boolean | undefined;
        progress?: SyncProgress | undefined;
        toolCalls?: boolean | undefined;
        threadLink?: ThreadLink | undefined;
        subagents?:
          | {
              finalAnswers?: boolean | undefined;
              progress?: boolean | undefined;
              toolCalls?: boolean | undefined;
            }
          | undefined;
      }
    | undefined;
  approval?: readonly ApprovalRule[] | undefined;
}

/**
 * The inherited defaults block shared by `policy.yml`, account files, and
 * routes. The authored examples restate every knob so each file is
 * self-reviewable; omitted leaves inherit per `DefaultsLayer`.
 */
export const ChannelDefaultsSchema = z
  .object({
    interaction: InteractionDefaultsSchema.optional(),
    binding: BindingDefaultsSchema.optional(),
    reply: ReplyDefaultsSchema.optional(),
    outbound: OutboundDefaultsSchema.optional(),
    inbound: InboundDefaultsSchema.optional(),
    access: AccessDefaultsSchema.optional(),
    sync: SyncDefaultsSchema.optional(),
    approval: z.array(ApprovalRuleSchema).optional(),
  })
  .strict();
export type ChannelDefaults = z.infer<typeof ChannelDefaultsSchema>;

// --- policy.yml (§4.3.2) -------------------------------------------------------

export const RoleSchema = z
  .object({
    grants: z.array(z.string().min(1)),
    deny: z.array(z.string().min(1)).optional(),
    extends: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type Role = z.infer<typeof RoleSchema>;

export const UserRecordSchema = z
  .object({
    name: z.string().min(1).optional(),
    identities: z.array(ChannelIdentitySchema),
  })
  .strict();
export type UserRecord = z.infer<typeof UserRecordSchema>;

export const ChannelEnabledEntrySchema = z.object({ enabled: z.boolean() }).strict();
export type ChannelEnabledEntry = z.infer<typeof ChannelEnabledEntrySchema>;

/** `defaults.defaultRoles` — inherited like every other default key (§4.3.7). */
export const DefaultRolesSchema = z.array(z.string().min(1)).optional();

export const OrgPolicySchema = z
  .object({
    enabled: z.boolean().default(true),
    channels: z.record(z.string().min(1), ChannelEnabledEntrySchema).optional(),
    roles: z.record(z.string().min(1), RoleSchema).optional(),
    users: z.record(z.string().min(1), UserRecordSchema).optional(),
    assignments: z.array(RoleAssignmentSchema).optional(),
    defaults: ChannelDefaultsSchema.extend({
      defaultRoles: DefaultRolesSchema,
    }).optional(),
  })
  .strict();
export type OrgPolicy = z.infer<typeof OrgPolicySchema>;

// --- Account files (§4.3.3) ----------------------------------------------------

export const SlackTransportSchema = z
  .object({
    mode: SlackTransportModeSchema,
    // P0.5: per-account ingress route, auto-registered by the control plane.
    webhookPath: z.string().min(1).optional(),
    errorPolicy: ErrorPolicySchema.optional(),
    // Where the native approval card (buttons) may appear — the approval
    // engine's prompt-posting decision reads it (default off). `allowlist`
    // is fail-closed at P0; no effect until the companion allowlist key lands.
    inlineButtons: InlineButtonsSchema.optional(),
    // The app-manifest-registered NATIVE slash command name (e.g. `/paseo`)
    // whose Socket Mode `slash_commands` events the vertical rewrites to the
    // shared plain-text commands (`/paseo approve` → `approve`). Absent =
    // native slash ingestion off; the in-message `/approve` + `\approve`
    // text spellings always work with zero app setup (commands.ts).
    slashCommand: z
      .string()
      .regex(/^\/[a-z][a-z0-9_]{2,31}$/u, "a Slack command name: /lowercase, 3-32 chars")
      .optional(),
  })
  .strict();
export type SlackTransport = z.infer<typeof SlackTransportSchema>;

export const TelegramTransportSchema = z
  .object({
    mode: TelegramTransportModeSchema,
    errorPolicy: ErrorPolicySchema.optional(),
    // Where the native approval card (inline keyboard) may appear — the
    // approval engine's prompt-posting decision reads it (default off).
    // `allowlist` is fail-closed at P0; no effect until the companion
    // allowlist key lands.
    inlineButtons: InlineButtonsSchema.optional(),
  })
  .strict();
export type TelegramTransport = z.infer<typeof TelegramTransportSchema>;

export const DiscordTransportSchema = z
  .object({
    mode: DiscordTransportModeSchema,
    errorPolicy: ErrorPolicySchema.optional(),
    // Where the native approval card (message components) may appear — the
    // approval engine's prompt-posting decision reads it (default off).
    // `allowlist` is fail-closed at P0; no effect until the companion allowlist
    // key lands.
    inlineButtons: InlineButtonsSchema.optional(),
  })
  .strict();
export type DiscordTransport = z.infer<typeof DiscordTransportSchema>;

export const GoogleChatTransportSchema = z
  .object({
    mode: GoogleChatTransportModeSchema,
    errorPolicy: ErrorPolicySchema.optional(),
  })
  .strict();
export type GoogleChatTransport = z.infer<typeof GoogleChatTransportSchema>;

export const FeishuTransportSchema = z
  .object({
    mode: FeishuTransportModeSchema,
    errorPolicy: ErrorPolicySchema.optional(),
  })
  .strict();
export type FeishuTransport = z.infer<typeof FeishuTransportSchema>;

export const ZalouserTransportSchema = z
  .object({
    mode: ZalouserTransportModeSchema,
    errorPolicy: ErrorPolicySchema.optional(),
  })
  .strict();
export type ZalouserTransport = z.infer<typeof ZalouserTransportSchema>;

export const ZaloTransportSchema = z
  .object({
    mode: ZaloTransportModeSchema,
    errorPolicy: ErrorPolicySchema.optional(),
  })
  .strict();
export type ZaloTransport = z.infer<typeof ZaloTransportSchema>;

// --- Vertical-owned account config (`account.config`) ---------------------------
//
// The account's `config` block is passed through to the vertical verbatim
// (`AccountFileSchema.config`), because each vertical type-checks its own keys on
// read. For the channels wired in slices 14b/15b/16b the Hub additionally
// TYPE-CHECKS the keys the vertical's drive path depends on, so a `webhookPort:
// "8080"` fails at deploy instead of at start. The shapes stay LOOSE: upstream
// account files carry knobs this Hub never reads, and rejecting them would make
// an OpenClaw-authored account uncompilable.

/** `channels.googlechat.accounts.<id>` — the keys `lifecycle/start-account.ts`
 * and `accounts.ts` read. `audienceType`/`audience`/`webhookUrl` are required
 * for the account to start; the compiler checks their TYPES here and the
 * vertical refuses the start when one is missing. */
export const GoogleChatAccountConfigSchema = z.looseObject({
  audienceType: z.enum(["app-url", "project-number"]).optional(),
  audience: z.string().min(1).optional(),
  /** The numeric OAuth 2.0 client id add-on tokens must carry (NOT an email);
   * only meaningful with `audienceType: "app-url"`. */
  appPrincipal: z.string().min(1).optional(),
  webhookUrl: z.string().min(1).optional(),
  webhookPath: z.string().min(1).optional(),
  webhookPort: z.number().int().min(1).max(65_535).optional(),
  webhookHost: z.string().min(1).optional(),
  /** `users/<id>`; without it mention detection only knows the `users/app` alias. */
  botUser: z.string().min(1).optional(),
  allowBots: z.boolean().optional(),
  mediaMaxMb: z.number().positive().optional(),
  textChunkLimit: z.number().int().positive().optional(),
});
export type GoogleChatAccountConfig = z.infer<typeof GoogleChatAccountConfigSchema>;

/** `channels.feishu.accounts.<id>` — the keys the ported `accounts.ts` and
 * `tools-config.ts` read. Credentials (`appId`, `appSecret`,
 * `verificationToken`, `encryptKey`) normally arrive on the connection carrier,
 * never in an authored revision, but the shape accepts them for parity with the
 * upstream account file. */
export const FeishuAccountConfigSchema = z.looseObject({
  appId: z.string().min(1).optional(),
  appSecret: z.string().min(1).optional(),
  verificationToken: z.string().min(1).optional(),
  encryptKey: z.string().min(1).optional(),
  domain: z.enum(["feishu", "lark"]).optional(),
  connectionMode: FeishuTransportModeSchema.optional(),
  webhookPath: z.string().min(1).optional(),
  webhookPort: z.number().int().min(1).max(65_535).optional(),
  webhookHost: z.string().min(1).optional(),
  allowBots: z.boolean().optional(),
  actions: z
    .looseObject({ reactions: z.boolean().optional(), sticker: z.boolean().optional() })
    .optional(),
  /** The tool-family gate; upstream defaults everything on except `perm`. */
  tools: z
    .looseObject({
      doc: z.boolean().optional(),
      chat: z.boolean().optional(),
      wiki: z.boolean().optional(),
      drive: z.boolean().optional(),
      perm: z.boolean().optional(),
      scopes: z.boolean().optional(),
      bitable: z.boolean().optional(),
    })
    .optional(),
  mediaMaxMb: z.number().positive().optional(),
  httpTimeoutMs: z.number().int().positive().optional(),
});
export type FeishuAccountConfig = z.infer<typeof FeishuAccountConfigSchema>;

/** `channels.zalo.accounts.<id>` — the keys the ported `accounts.ts`,
 * `start-account.ts` and `proxy.ts` read. `botNames` is Fusion-added: the Zalo
 * Bot API carries no mention annotation, so a group mention is matched against
 * the bot's own `getMe` name plus these aliases. */
export const ZaloAccountConfigSchema = z.looseObject({
  webhookUrl: z.string().min(1).optional(),
  webhookPath: z.string().min(1).optional(),
  webhookPort: z.number().int().min(1).max(65_535).optional(),
  webhookHost: z.string().min(1).optional(),
  /** 8-256 chars, enforced again by the vertical at start. */
  webhookSecret: z.string().min(8).max(256).optional(),
  mediaMaxMb: z.number().positive().optional(),
  proxy: z.string().min(1).optional(),
  botNames: z.array(z.string().min(1)).optional(),
});

export type ZaloAccountConfig = z.infer<typeof ZaloAccountConfigSchema>;

/** `channels.zalouser.accounts.<id>` — the keys `fusion/account-config.ts`,
 * `group-policy.ts` and the outbound chunker read. There is NO credential key:
 * the session is created by the QR scan and rests in the Hub's encrypted
 * keyed-store namespace (`packages/channels/zalouser/HUB-WIRING.md` §6), so the
 * only identity leaf here is the non-secret `profile` label. */
export const ZalouserAccountConfigSchema = z.looseObject({
  /** The credential profile — the session store key. Defaults to the account id. */
  profile: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  mediaMaxMb: z.number().positive().optional(),
  historyLimit: z.number().int().positive().optional(),
  textChunkMode: z.enum(["length", "newline"]).optional(),
  textChunkLimit: z.number().int().positive().optional(),
  /** Break-glass: with it off, a `groups` entry that is a group NAME rather than
   * an id is ignored for policy, because a name is mutable and can drift onto
   * an untrusted room. */
  dangerouslyAllowNameMatching: z.boolean().optional(),
  groups: z
    .record(
      z.string(),
      z.looseObject({
        enabled: z.boolean().optional(),
        requireMention: z.boolean().optional(),
      }),
    )
    .optional(),
});
export type ZalouserAccountConfig = z.infer<typeof ZalouserAccountConfigSchema>;

export const RouteMatchSchema = z
  .object({
    kind: RouteMatchKindSchema,
    // Native provider ids: Slack channel/thread ids, Telegram chat ids (numbers
    // in YAML are accepted and normalized to strings at compile).
    ids: z.array(z.union([z.string(), z.number()])).optional(),
    // Optional literal content discriminator. This selects a route only when
    // no durable direct-Agent binding already owns the inbound conversation.
    contains: z.string().min(1).optional(),
  })
  .strict();
export type RouteMatch = z.infer<typeof RouteMatchSchema>;

export const RouteAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("members") }).strict(),
  z.object({ kind: z.literal("conversationParticipants") }).strict(),
]);
export type RouteAudience = z.infer<typeof RouteAudienceSchema>;

/**
 * Instance safety ceilings for one Route. An authored value may be lower but
 * never higher. Open-audience Routes inherit the conservative preset when a
 * leaf is omitted; Member Routes remain unchanged unless they opt in.
 */
export const ROUTE_LIMIT_CEILINGS = {
  maxInputCharacters: 8_000,
  messagesPerMinutePerSender: 10,
  messagesPerMinute: 60,
  maxConcurrentRuns: 2,
  maxRuntimeSeconds: 15 * 60,
} as const;

export const OPEN_AUDIENCE_ROUTE_LIMITS = ROUTE_LIMIT_CEILINGS;

export const RouteLimitsSchema = z
  .object({
    maxInputCharacters: z
      .number()
      .int()
      .positive()
      .max(ROUTE_LIMIT_CEILINGS.maxInputCharacters)
      .optional(),
    messagesPerMinutePerSender: z
      .number()
      .int()
      .positive()
      .max(ROUTE_LIMIT_CEILINGS.messagesPerMinutePerSender)
      .optional(),
    messagesPerMinute: z
      .number()
      .int()
      .positive()
      .max(ROUTE_LIMIT_CEILINGS.messagesPerMinute)
      .optional(),
    maxConcurrentRuns: z
      .number()
      .int()
      .positive()
      .max(ROUTE_LIMIT_CEILINGS.maxConcurrentRuns)
      .optional(),
    maxRuntimeSeconds: z
      .number()
      .int()
      .positive()
      .max(ROUTE_LIMIT_CEILINGS.maxRuntimeSeconds)
      .optional(),
  })
  .strict();
export type RouteLimits = z.infer<typeof RouteLimitsSchema>;

/**
 * A route's target: exactly one of `agent` + `environment` (continuous session,
 * names into the Channel resource registry) or `workflow` (hand-off to the
 * enabled organization Trigger with that name).
 * Enforced as a refinement, not a discriminated union, so per-route overrides
 * can be shared across both shapes.
 */
export const RouteSchema = z
  .object({
    match: RouteMatchSchema,
    audience: RouteAudienceSchema.optional(),
    agent: z.string().min(1).optional(),
    environment: z.string().min(1).optional(),
    workflow: z.string().min(1).optional(),
    // The alternatives `/agent <name>` and `/model <name>` may switch to.
    // `agent:` (the route's own target) is always selectable; these are the
    // OTHER names an owner/admin may pick. Empty or absent = no switching.
    agents: z.array(z.string().min(1)).optional(),
    models: z.array(z.string().min(1)).optional(),
    template: z.string().min(1).optional(),
    policy: z
      .object({
        defaultRoles: DefaultRolesSchema,
        assignments: z.array(RoleAssignmentSchema).optional(),
      })
      .strict()
      .optional(),
    interaction: InteractionDefaultsSchema.optional(),
    binding: BindingDefaultsSchema.optional(),
    reply: ReplyDefaultsSchema.optional(),
    outbound: OutboundDefaultsSchema.optional(),
    access: AccessDefaultsSchema.optional(),
    sync: SyncDefaultsSchema.optional(),
    approval: z.array(ApprovalRuleSchema).optional(),
    limits: RouteLimitsSchema.optional(),
  })
  .strict();
export type Route = z.infer<typeof RouteSchema>;

export const FallbackSchema = z.union([
  z.object({ deny: z.literal(true) }).strict(),
  RouteSchema.omit({ match: true }),
]);
export type Fallback = z.infer<typeof FallbackSchema>;

export const AccountFileSchema = z
  .object({
    channel: z.string().min(1),
    accountId: z.string().min(1),
    enabled: z.boolean().default(true),
    connectionId: z.string().min(1),
    transport: z.unknown(), // channel-specific; validated against the channel's transport schema in compile
    // Vertical-owned account settings (e.g. Telegram's `richMessages`,
    // `timeoutSeconds`, `apiRoot`): passed through verbatim to the vertical's
    // cfg entry, where each key is type-checked on read (bot-api
    // resolveTelegramAccount). The hub never interprets these.
    config: z.record(z.string(), z.unknown()).optional(),
    policy: z
      .object({
        defaultRoles: DefaultRolesSchema,
        assignments: z.array(RoleAssignmentSchema).optional(),
      })
      .strict()
      .optional(),
    defaults: ChannelDefaultsSchema.optional(),
    routes: z.array(RouteSchema).optional(),
    fallback: FallbackSchema.optional(),
  })
  .strict();
export type AccountFile = z.infer<typeof AccountFileSchema>;
