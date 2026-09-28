import { z } from "zod";
import { AgentProfileSchema } from "../agent-profile.js";
import { SessionActorSchema } from "../session-authorship.js";

/**
 * The daemon-side Bot record (docs/features/bots-and-chats/README.md, D2).
 * Durable facts only: no running session, no transport state. The wire payload
 * is the record itself, so the store, the daemon and the app share one type.
 */
export const BotKindSchema = z.enum(["personal", "team"]);
export type BotKind = z.infer<typeof BotKindSchema>;

/** Launch defaults carry the agent-control fields of an Agent profile, nothing else. */
export const BotLaunchDefaultsSchema = z.object({
  provider: AgentProfileSchema.shape.provider,
  model: AgentProfileSchema.shape.model,
  modeId: AgentProfileSchema.shape.modeId,
  thinkingOptionId: AgentProfileSchema.shape.thinkingOptionId,
  featureValues: AgentProfileSchema.shape.featureValues,
});
export type BotLaunchDefaults = z.infer<typeof BotLaunchDefaultsSchema>;

export const BotTemplateStateSchema = z.object({
  id: z.string(),
  seededAt: z.string(),
});
export type BotTemplateState = z.infer<typeof BotTemplateStateSchema>;

export const StoredBotSchema = z.object({
  /** `bot_<16 hex>`, opaque. */
  id: z.string(),
  /** The immutable directory name (D3). */
  slug: z.string(),
  /** The display name; changes freely. */
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  kind: BotKindSchema,
  projectId: z.string(),
  workspaceId: z.string(),
  /** The exact home directory, never re-derived from `slug`. */
  cwd: z.string(),
  launch: BotLaunchDefaultsSchema,
  template: BotTemplateStateSchema.nullable(),
  owner: SessionActorSchema,
  scheduleIds: z.array(z.string()).optional(),
  heartbeatIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  /** References by id only (D2); the shape is decided with the tool policy work. */
  mcpToolPolicy: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
export type StoredBot = z.infer<typeof StoredBotSchema>;

// Session-projected capability; never persisted as Bot ownership or authority.
export const BotPayloadSchema = StoredBotSchema.extend({
  // COMPAT(botConfigureAuthority): older hosts omit; configuration UI fails closed.
  canConfigure: z.boolean().optional(),
  // COMPAT(botOwnerProjection): older hosts omit; client ownership filters keep unknown in All.
  // Session-relative display metadata, never an authorization grant.
  isOwner: z.boolean().optional(),
});
export type BotPayload = z.infer<typeof BotPayloadSchema>;

/** The `errorCode` values a `bot.*` reply carries; the wire keeps the field a plain string. */
export const BOT_ERROR_CODES = [
  "bots_disabled",
  "invalid_request",
  "provider_unavailable",
  "home_root",
  "inside_project",
  "access_denied",
  "bot_not_found",
  "bot_archived",
] as const;
export type BotErrorCode = (typeof BOT_ERROR_CODES)[number];
