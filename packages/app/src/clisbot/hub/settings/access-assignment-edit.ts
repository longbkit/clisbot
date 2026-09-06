import { z } from "zod";

const conversationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("specific"), conversationIds: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("direct_messages") }),
  z.object({ kind: z.literal("public_channels") }),
]);
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
  return {
    valid: conversation.success && configurations.success,
    conversation: conversation.data?.kind ?? "specific",
    conversationIds:
      conversation.data?.kind === "specific" ? conversation.data.conversationIds.join(", ") : "",
    agentConfigurations: (configurations.data ?? []).flatMap((configuration) => {
      const models = configuration.modelIds === "*" ? ["*"] : configuration.modelIds;
      const thinking =
        configuration.thinkingOptionIds === "*" ? ["*"] : configuration.thinkingOptionIds;
      return models.flatMap((modelId) =>
        thinking.map((thinkingOptionId) => ({
          providerId: configuration.providerId,
          modelId,
          thinkingOptionId,
        })),
      );
    }),
  };
}

/** Preserve published constraints, including grouped configuration grants, until edited. */
export function mergeAccessConstraints(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing) return next;
  const merged = { ...existing, ...next };
  for (const key of ["conversation", "agentConfigurations"] as const) {
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
