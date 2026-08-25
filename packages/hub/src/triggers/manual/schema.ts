import { z } from "zod";

export const ManualTriggerPayloadSchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
  projectId: z.string().uuid("projectId is required"),
  connectionId: z.string().uuid().nullable().optional(),
  resourceId: z.string().nullable().optional(),
  source: z
    .string()
    .min(1, "source is required and must be a non-empty string")
    .includes(".", "source must be provider-namespaced, for example github.issue_comment"),
  deliveryId: z.string().min(1, "deliveryId is required and must be a non-empty string"),
  receivedAt: z.preprocess((value) => {
    if (value === undefined) {
      return new Date();
    }

    if (typeof value === "string") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date;
    }

    return value;
  }, z.date("receivedAt must be an ISO date string when provided")),
  payload: z.unknown(),
});

export type ManualTriggerInput = z.infer<typeof ManualTriggerPayloadSchema>;
