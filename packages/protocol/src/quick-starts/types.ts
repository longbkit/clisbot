import { z } from "zod";
import { BotLaunchDefaultsSchema } from "../bots/types.js";

export const QuickStartOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hostOwner") }),
  z.object({
    kind: z.literal("hubUser"),
    hubIdentity: z.string().min(1),
    organizationId: z.string().min(1),
    subjectId: z.string().min(1),
  }),
]);
export const QuickStartTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("quickChat") }),
  z.object({ kind: z.literal("bot"), botId: z.string().min(1) }),
  z.object({
    kind: z.literal("project"),
    projectId: z.string().min(1),
    workspace: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("local") }),
      z.object({
        kind: z.literal("worktree"),
        base: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("default") }),
          z.object({ kind: z.literal("ref"), refName: z.string().min(1).max(1024) }),
          z.object({ kind: z.literal("ask") }),
        ]),
      }),
    ]),
  }),
]);
export const QuickStartInputSchema = z.object({
  name: z.string().min(1).max(120),
  visibility: z.enum(["personal", "host"]),
  target: QuickStartTargetSchema,
  startingPrompt: z.string().max(100000),
  agent: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("default") }),
    z.object({ kind: z.literal("configured"), config: BotLaunchDefaultsSchema }),
  ]),
});
export const QuickStartSchema = QuickStartInputSchema.extend({
  id: z.string().regex(/^qs_[a-f0-9]{16}$/),
  owner: QuickStartOwnerSchema,
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const QuickStartViewSchema = QuickStartSchema.extend({
  canEdit: z.boolean(),
  available: z.boolean(),
});
export const QuickStartPreferencesSchema = z.object({
  owner: QuickStartOwnerSchema,
  pinnedIds: z.array(z.string()).max(500),
  revision: z.number().int().nonnegative(),
});
export type QuickStartOwner = z.infer<typeof QuickStartOwnerSchema>;
export type QuickStartTarget = z.infer<typeof QuickStartTargetSchema>;
export type QuickStartInput = z.infer<typeof QuickStartInputSchema>;
export type QuickStart = z.infer<typeof QuickStartSchema>;
export type QuickStartView = z.infer<typeof QuickStartViewSchema>;
export type QuickStartPreferences = z.infer<typeof QuickStartPreferencesSchema>;
export function quickStartOwnerKey(owner: QuickStartOwner): string {
  return owner.kind === "hostOwner"
    ? "hostOwner"
    : JSON.stringify([owner.hubIdentity, owner.organizationId, owner.subjectId]);
}
