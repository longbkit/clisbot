import { z } from "zod";
import type { OutputExecutor } from "../../execution-capabilities/outputs.js";
import type { LinearApiClient } from "../../providers/linear/client.js";

const LinearReplyArgsSchema = z.object({ content: z.string().min(1) });
const LinearReplyOutputContextSchema = z.object({
  provider: z.literal("linear"),
  linearOrganizationId: z.string().min(1),
  issueId: z.string().min(1),
});

/** Emits a normal Linear issue comment, suitable for a concise eligibility result or draft PR URL. */
export function createLinearReplyExecutor(options: { client: LinearApiClient }): OutputExecutor {
  return async function executeLinearReply(input) {
    const args = LinearReplyArgsSchema.parse(input.args);
    const context = LinearReplyOutputContextSchema.parse(input.outputContext);
    await options.client.createComment({
      linearOrganizationId: context.linearOrganizationId,
      issueId: context.issueId,
      body: args.content,
    });
  };
}
