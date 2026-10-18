import { z } from "zod";
import { AgentAttachmentSchema, ImageAttachmentSchema } from "./agent-attachments.js";

const ContentSchema = z.object({
  text: z.string().max(1024 * 1024),
  images: z.array(ImageAttachmentSchema).max(64).optional(),
  attachments: z.array(AgentAttachmentSchema).max(64).optional(),
});
export const InputQueueViewSchema = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(
    ContentSchema.extend({
      id: z.string(),
      state: z.enum(["queued", "sending", "needs_review"]),
      reason: z.string().optional(),
      createdAt: z.string(),
    }),
  ),
});
export type InputQueueView = z.infer<typeof InputQueueViewSchema>;
export const InputQueueCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read_file"),
    id: z.string(),
    fileId: z.string(),
    offset: z.number().int().nonnegative(),
  }),
  z.object({ action: z.literal("fetch"), revision: z.number().int().nonnegative().optional() }),
  ContentSchema.extend({ action: z.literal("enqueue"), id: z.string().min(1).max(200) }),
  ContentSchema.extend({
    action: z.enum(["update", "move_to_end"]),
    id: z.string(),
    revision: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("steer_now"),
    id: z.string(),
    revision: z.number().int().nonnegative(),
    target: z.object({ agentId: z.string().min(1), turnId: z.string().min(1) }),
  }),
  z.object({
    action: z.enum(["delete", "discard", "send_now"]),
    id: z.string(),
    revision: z.number().int().nonnegative(),
  }),
]);
export type InputQueueCommand = z.infer<typeof InputQueueCommandSchema>;
// COMPAT(hostInputQueue): optional on older Hosts; session client fallback belongs to the app, not these RPCs. Review 2027-04-18.
export const AgentQueueExecuteRequestSchema = z.object({
  type: z.literal("agent.queue.execute.request"),
  requestId: z.string(),
  agentId: z.string(),
  sessionOperationTicket: z.string().optional(),
  command: InputQueueCommandSchema,
});
export const ChatQueueExecuteRequestSchema = z.object({
  type: z.literal("chat.queue.execute.request"),
  requestId: z.string(),
  chatId: z.string(),
  command: InputQueueCommandSchema,
});
export const AgentQueueExecuteResponseSchema = z.object({
  type: z.literal("agent.queue.execute.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    queue: InputQueueViewSchema.nullable(),
    error: z.string().nullable(),
    fileChunk: z.object({ data: z.string(), done: z.boolean() }).optional(),
    unchanged: z.boolean().optional(),
    errorCode: z.string().optional(),
  }),
});
export const ChatQueueExecuteResponseSchema = z.object({
  type: z.literal("chat.queue.execute.response"),
  payload: z.object({
    requestId: z.string(),
    chatId: z.string(),
    queue: InputQueueViewSchema.nullable(),
    error: z.string().nullable(),
    fileChunk: z.object({ data: z.string(), done: z.boolean() }).optional(),
    unchanged: z.boolean().optional(),
    errorCode: z.string().optional(),
  }),
});
