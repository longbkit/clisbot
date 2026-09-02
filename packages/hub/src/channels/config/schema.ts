// Authored YAML shapes for the channel control plane (implementation doc §4.3.2,
// §4.3.3, §4.3.6). These parse the files under `.paseo/channels/`; cross-reference
// validation (agents/environments/workflows/users) happens in `compile.ts`.

import { z } from "zod";
import {
  ApprovalModeSchema,
  BindingKeySchema,
  ErrorPolicySchema,
  FollowUpModeSchema,
  InlineButtonsSchema,
  isApprovalMatchPattern,
  MessageReactionSchema,
  OutboundPathSchema,
  ReplyAnchorSchema,
  RouteMatchKindSchema,
  SlackTransportModeSchema,
  TelegramTransportModeSchema,
  ThreadLinkSchema,
} from "./enums.js";
import type { BindingKey, FollowUpMode, OutboundPath, ReplyAnchor, ThreadLink } from "./enums.js";

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
 * The org-layer effective values for `defaults:` (§4.3.2/§4.3.6). The compiler
 * applies these when the org `policy.yml` omits a key; account and route
 * layers only override.
 */
export const ORG_DEFAULTS = {
  defaultRoles: [],
  interaction: { requireMention: true, followUp: { mode: "auto", ttlMinutes: 60 } },
  binding: { key: "thread" },
  reply: { anchor: "default" },
  outbound: { path: "relay" as const, template: null },
  sync: {
    finalAnswers: true,
    // The progress group's floor: the relay line and the native typing
    // indicator are on; the inbound-message reaction is off (it leaves an
    // artefact on the user's own message, so it stays opt-in).
    progress: { progressMessage: true, typingIndicator: true, messageReaction: "off" },
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
    defaults: ChannelDefaultsSchema.extend({ defaultRoles: DefaultRolesSchema }).optional(),
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

export const RouteMatchSchema = z
  .object({
    kind: RouteMatchKindSchema,
    // Native provider ids: Slack channel/thread ids, Telegram chat ids (numbers
    // in YAML are accepted and normalized to strings at compile).
    ids: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .strict();
export type RouteMatch = z.infer<typeof RouteMatchSchema>;

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
    agent: z.string().min(1).optional(),
    environment: z.string().min(1).optional(),
    workflow: z.string().min(1).optional(),
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
    sync: SyncDefaultsSchema.optional(),
    approval: z.array(ApprovalRuleSchema).optional(),
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
