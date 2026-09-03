import { z } from "zod";
import { type TriggerProvider, type TriggerProviderMatch } from "../index.js";
import { matchesInputFilters, parseInvocation, parseStructuredInvocation } from "../invocation.js";
import type { WorkflowConfigurationResolver } from "../configuration.js";

export const ManualRunPayloadSchema = z.object({
  expectedVersionId: z.string().uuid().optional(),
  trigger: z.string().min(1),
  actor: z.string().min(1),
  input: z.unknown(),
  publicDeliveryKey: z.string().min(1).optional(),
});

const ManualInvocationValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

/** Member-facing direct-run input. Target, Agent controls, and authority stay revision-owned. */
export const ManualInvocationInputSchema = z
  .object({
    prompt: z.string().max(100_000),
    inputs: z
      .record(z.string().regex(/^[a-z][a-z0-9_-]*$/u), ManualInvocationValueSchema)
      .default({}),
  })
  .strict();

export type ManualRunPayload = z.infer<typeof ManualRunPayloadSchema>;
export interface ManualMergeData {
  manual: {
    actor: string;
    input: unknown;
    trigger: string;
    delivery_id: string;
    expected_version_id?: string;
  };
}
export interface ManualRunContext {
  provider: "manual";
  deliveryId: string;
  event: ManualMergeData;
}
export interface ManualRunOutputContext {
  provider: "manual";
  actor: string;
}

export type ManualRunRejectionCode =
  | "configuration_not_found"
  | "expected_configuration_not_current"
  | "trigger_not_found"
  | "actor_forbidden";

export class ManualRunRejected extends Error {
  constructor(readonly code: ManualRunRejectionCode) {
    super(`manual run rejected: ${code}`);
    this.name = "ManualRunRejected";
  }
}

export function createManualRunProvider(
  configurationForWorkflow: WorkflowConfigurationResolver,
): TriggerProvider<"manual", ManualRunContext, ManualRunOutputContext> {
  return {
    name: "manual",
    eventNames: ["manual.run"],
    async match(external) {
      const payload = ManualRunPayloadSchema.parse(external.payload);
      const stored = await configurationForWorkflow(external);
      if (!stored) {
        throw new ManualRunRejected("configuration_not_found");
      }
      if (
        payload.expectedVersionId !== undefined &&
        stored.revision.id !== payload.expectedVersionId
      ) {
        throw new ManualRunRejected("expected_configuration_not_current");
      }
      const trigger = stored.configuration.triggers.find(
        (candidate) => candidate.name === payload.trigger && candidate.on === "manual.run",
      );
      if (!trigger) throw new ManualRunRejected("trigger_not_found");
      if (
        !trigger.filters?.from_users?.includes("*") &&
        !trigger.filters?.from_users?.includes(payload.actor)
      )
        throw new ManualRunRejected("actor_forbidden");
      const event: ManualMergeData = {
        manual: {
          actor: payload.actor,
          input: payload.input,
          trigger: payload.trigger,
          delivery_id: payload.publicDeliveryKey ?? external.deliveryId,
          ...(payload.expectedVersionId === undefined
            ? {}
            : { expected_version_id: payload.expectedVersionId }),
        },
      };
      const triggerContext: ManualRunContext = {
        provider: "manual",
        deliveryId: payload.publicDeliveryKey ?? external.deliveryId,
        event,
      };
      const outputContext: ManualRunOutputContext = { provider: "manual", actor: payload.actor };
      const structuredInput = ManualInvocationInputSchema.safeParse(payload.input);
      const invocation = structuredInput.success
        ? parseStructuredInvocation(
            structuredInput.data.prompt,
            trigger.inputs,
            structuredInput.data.inputs,
          )
        : parseInvocation(typeof payload.input === "string" ? payload.input : "", trigger.inputs);
      if (invocation.status === "rejected") {
        return [
          {
            triggerName: trigger.name,
            triggerContext,
            outputContext,
            configurationRevisionId: stored.revision.id,
            hubConfig: stored.configuration,
            invocation,
          },
        ];
      }
      if (invocation.status === "accepted") {
        if (!matchesInputFilters(invocation.inputs, trigger.filters?.inputs))
          return "trigger_filters_rejected";
      }
      const match: TriggerProviderMatch<ManualRunContext, ManualRunOutputContext> = {
        triggerName: trigger.name,
        triggerContext,
        outputContext,
        configurationRevisionId: stored.revision.id,
        hubConfig: stored.configuration,
        invocation,
      };
      return [match];
    },
  };
}
