import { z } from "zod";
import { parseCompiledHubConfig } from "../../config/compiler.js";
import type { Database } from "../../db/types.js";
import type { CompiledRoute } from "../../channels/config/compile.js";
import { parseInvocation } from "../invocation.js";
import type { TriggerProvider, TriggerProviderMatch } from "../index.js";

export const ChannelWorkflowRequestPayloadSchema = z.object({
  workflow: z.string().min(1),
  text: z.string(),
  channel: z.object({
    name: z.enum(["slack", "telegram"]),
    account_id: z.string().min(1),
    binding_key: z.string().min(1),
    external_conversation_id: z.string().min(1),
    external_thread_id: z.string().nullable(),
    sender_identity: z.string().min(1),
    sender_name: z.string().optional(),
    root_kind: z.enum(["dm", "channel", "group"]),
    trigger_thread_id: z.string().nullable(),
    trigger_message_id: z.string().optional(),
    route:
      z.custom<Pick<CompiledRoute, "defaultRoles" | "assignments" | "defaults" | "approval">>(),
  }),
});

export const ChannelWorkflowPayloadSchema = ChannelWorkflowRequestPayloadSchema.extend({
  workflow_id: z.string().uuid(),
  workflow_revision_id: z.string().uuid(),
});

export type ChannelWorkflowRequestPayload = z.infer<typeof ChannelWorkflowRequestPayloadSchema>;
export type ChannelWorkflowPayload = z.infer<typeof ChannelWorkflowPayloadSchema>;

export function createChannelWorkflowProvider(
  database: Pick<Database, "findOrganizationTriggerRevision">,
): TriggerProvider<"channel"> {
  return {
    name: "channel",
    eventNames: ["channel.message"],
    async match(external) {
      const payload = ChannelWorkflowPayloadSchema.parse(external.payload);
      const stored = await database.findOrganizationTriggerRevision(
        payload.workflow_id,
        payload.workflow_revision_id,
      );
      if (stored === undefined) return "configuration_unavailable";
      if (stored.organizationId !== external.organizationId) return "configuration_unavailable";
      const configuration = parseCompiledHubConfig(stored.normalizedConfiguration);
      const workflow = configuration.triggers[0];
      if (workflow === undefined) return "no_trigger_for_source";
      const invocation = parseInvocation(payload.text, workflow.inputs);
      const base = {
        triggerName: workflow.name,
        configurationRevisionId: external.configurationRevisionId,
        hubConfig: configuration,
        triggerContext: {
          provider: "channel",
          deliveryId: external.deliveryId,
          event: payload,
        },
        outputContext: { provider: "channel", channel: payload.channel },
      };
      const match: TriggerProviderMatch =
        invocation.status === "accepted" ? { ...base, invocation } : { ...base, invocation };
      return [match];
    },
  };
}
