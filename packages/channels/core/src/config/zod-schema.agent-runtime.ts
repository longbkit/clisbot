// Fusion-owned partial port of `src/config/zod-schema.agent-runtime.ts` (D-CORE-338).
//
// Upstream's module is the agent-runtime config zod surface (provider profiles,
// Codex sandbox knobs, harness selection). Fusion's Hub owns agent
// configuration; only the tool-policy shape the ported channel group schemas
// embed is carried, with upstream's definition and message.
import { z } from "zod";

const ToolPolicyBaseSchema = z
  .object({
    allow: z.array(z.string()).optional(),
    alsoAllow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict();

export const ToolPolicySchema = ToolPolicyBaseSchema.superRefine((value, ctx) => {
  if (value.allow && value.allow.length > 0 && value.alsoAllow && value.alsoAllow.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "tools policy cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
    });
  }
}).optional();
