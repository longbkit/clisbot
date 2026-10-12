import { z } from "zod";
import {
  QuickStartInputSchema,
  QuickStartViewSchema,
  QuickStartPreferencesSchema,
} from "./types.js";
export const QuickStartListRequestSchema = z.object({
  type: z.literal("quick_start.list.request"),
  requestId: z.string(),
});
export const QuickStartSaveRequestSchema = z.object({
  type: z.literal("quick_start.save.request"),
  requestId: z.string(),
  id: z.string().regex(/^qs_[a-f0-9]{16}$/),
  expectedRevision: z.number().int().nonnegative(),
  input: QuickStartInputSchema,
});
export const QuickStartDeleteRequestSchema = z.object({
  type: z.literal("quick_start.delete.request"),
  requestId: z.string(),
  id: z.string(),
  expectedRevision: z.number().int().positive(),
});
export const QuickStartPinRequestSchema = z.object({
  type: z.literal("quick_start.set_pins.request"),
  requestId: z.string(),
  pinnedIds: z.array(z.string()).max(500),
  expectedRevision: z.number().int().nonnegative(),
});
const result = z.object({
  requestId: z.string(),
  items: z.array(QuickStartViewSchema).optional(),
  preferences: QuickStartPreferencesSchema.optional(),
  error: z.string().nullable(),
  errorCode: z.string().optional(),
});
export const QuickStartListResponseSchema = z.object({
  type: z.literal("quick_start.list.response"),
  payload: result,
});
export const QuickStartSaveResponseSchema = z.object({
  type: z.literal("quick_start.save.response"),
  payload: result,
});
export const QuickStartDeleteResponseSchema = z.object({
  type: z.literal("quick_start.delete.response"),
  payload: result,
});
export const QuickStartPinResponseSchema = z.object({
  type: z.literal("quick_start.set_pins.response"),
  payload: result,
});
// Content-free invalidation: a subscriber must re-fetch under its current admission.
export const QuickStartChangedSchema = z.object({
  type: z.literal("quick_start.changed"),
  payload: z.object({ changed: z.literal(true) }),
});
export const QuickChatPrepareRequestSchema = z.object({
  type: z.literal("quick_chat.prepare.request"),
  requestId: z.string(),
});
export const QuickChatPrepareResponseSchema = z.object({
  type: z.literal("quick_chat.prepare.response"),
  payload: z.object({
    requestId: z.string(),
    projectId: z.string().optional(),
    cwd: z.string().optional(),
    error: z.string().nullable(),
  }),
});
