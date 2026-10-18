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
  forkLinks: z
    .object({
      version: z.literal(1),
      clientMessageId: z.string(),
      files: z.array(FileSchema),
      imageDigests: z.array(z.string()),
      forkSources: z
        .array(z.object({ agentId: z.string(), epoch: z.string(), seq: z.number() }))
        .optional(),
      forkPaths: z
        .array(
          z.object({
            attachmentIndex: z.number().int().nonnegative(),
            sourceRelativePath: z.string(),
            targetRelativePath: z.string(),
          }),
        )
        .optional(),
    })
    .optional(),
  fingerprint: z.string(),
  identity: z.object({
    actor: SessionActorSchema.optional(),
    channel: SessionChannelReferenceSchema.optional(),
    receivedAt: z.string().optional(),
  }),
});
export type StoredQueueContent = z.infer<typeof StoredQueueContentSchema>;
