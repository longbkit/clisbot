import { z } from "zod";
import { AgentAttachmentSchema } from "@clisbot/protocol/agent-attachments";
import {
  SessionActorSchema,
  SessionChannelReferenceSchema,
} from "@clisbot/protocol/session-authorship";

const FileSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  relativePath: z.string(),
});
export const StoredQueueContentSchema = z.object({
  text: z.string(),
  attachments: z.array(AgentAttachmentSchema).optional(),
  files: z.array(FileSchema),
  images: z.array(FileSchema),
  fingerprint: z.string(),
  identity: z.object({
    actor: SessionActorSchema.optional(),
    channel: SessionChannelReferenceSchema.optional(),
    receivedAt: z.string().optional(),
  }),
});
export type StoredQueueContent = z.infer<typeof StoredQueueContentSchema>;
