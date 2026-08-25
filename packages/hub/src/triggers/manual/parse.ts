import { ManualTriggerPayloadSchema, type ManualTriggerInput } from "./schema.js";

export function parseManualTriggerPayload(value: unknown): ManualTriggerInput | string {
  const parsed = ManualTriggerPayloadSchema.safeParse(value);

  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "invalid manual trigger payload";
  }

  return parsed.data;
}
