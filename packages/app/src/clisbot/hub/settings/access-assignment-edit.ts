import { z } from "zod";

const conversationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("specific"), conversationIds: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("direct_messages") }),
  z.object({ kind: z.literal("public_channels") }),
]);
const terminalProfilesSchema = z.union([z.literal("*"), z.array(z.string()).min(1)]);
const projectFoldersSchema = z.object({ allow: z.array(z.string()), deny: z.array(z.string()) });
const configurationSchema = z.array(
  z.object({
    providerId: z.string(),
    modelIds: z.union([z.literal("*"), z.array(z.string()).min(1)]),
    thinkingOptionIds: z.union([z.literal("*"), z.array(z.string()).min(1)]),
  }),
);

export function accessConstraintDraft(constraints: Record<string, unknown>) {
  const conversation = conversationSchema.optional().safeParse(constraints.conversation);
  const configurations = configurationSchema.optional().safeParse(constraints.agentConfigurations);
  const terminalProfiles = terminalProfilesSchema
    .optional()
    .safeParse(constraints.terminalProfiles);
  const projectFolders = projectFoldersSchema.optional().safeParse(constraints.projectFolders);
  return {
    valid:
      conversation.success &&
      configurations.success &&
      terminalProfiles.success &&
      projectFolders.success,
    conversation: conversation.data?.kind ?? "specific",
    conversationIds:
      conversation.data?.kind === "specific" ? conversation.data.conversationIds.join(", ") : "",
    // One stored grant is one editable row; flattening it into single-value rows
    // would turn one decision into a screen of near-identical cards.
    agentConfigurations: configurations.data ?? [],
    terminalProfiles: terminalProfiles.data ?? ("*" as const),
    projectFolders: projectFolders.data ?? null,
  };
}

/** Preserve published constraints, including grouped configuration grants, until edited. */
export function mergeAccessConstraints(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing) return next;
  const merged = { ...existing, ...next };
  for (const key of [
    "conversation",
    "agentConfigurations",
    "terminalProfiles",
    "projectFolders",
  ] as const) {
    if (!(key in next)) {
      delete merged[key];
      continue;
    }
    const previousDraft = accessConstraintDraft({ [key]: existing[key] });
    const nextDraft = accessConstraintDraft({ [key]: next[key] });
    if (previousDraft.valid && JSON.stringify(previousDraft) === JSON.stringify(nextDraft)) {
      merged[key] = existing[key];
    }
  }
  return merged;
}
