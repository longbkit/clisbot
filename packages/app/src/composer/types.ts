import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import type { AgentAttachment } from "@clisbot/protocol/agent-attachments";
import type { MessagePart } from "./message-parts";

export type ImageAttachment = AttachmentMetadata;

export type QueueMessageParts = (parts: MessagePart<AgentAttachment>[]) => Promise<void>;

export interface MessagePayload {
  text: string;
  attachments: ComposerAttachment[];
  cwd: string;
  forceSend?: boolean;
  activeTurnBehavior?: "steer" | "interrupt";
  /** Takes a draft over one message's limits as ordered Host queue items, where the Host has one. */
  queueParts?: QueueMessageParts;
}

/**
 * Text the draft owner hands the editor. `hydrated` is the owner's answer to a mount:
 * the draft's text as persisted or still pending from the editor that unmounted.
 */
export interface TextReplacement {
  kind: "initial" | "hydrated" | "replace";
  key: string;
  text: string;
}
