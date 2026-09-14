import { z } from "zod";
import type { AgentPermissionRequest, AgentPermissionResponse } from "./agent-types.js";

/** A trusted snapshot at the time of an operation, never an authorization grant. */
export const SessionActorSchema = z.object({
  kind: z.enum(["user", "automation", "system"]),
  id: z.string(),
  displayName: z.string().optional(),
  avatarUrl: z.string().optional(),
  hubOrigin: z.string().optional(),
  organizationId: z.string().optional(),
  connectionId: z.string().optional(),
  memberId: z.string().optional(),
});
export type SessionActor = z.infer<typeof SessionActorSchema>;

export const SessionChannelReferenceSchema = z.object({
  hubOrigin: z.string(),
  organizationId: z.string(),
  connectionId: z.string(),
  channelId: z.string(),
  displayName: z.string().optional(),
});
export type SessionChannelReference = z.infer<typeof SessionChannelReferenceSchema>;

export function sessionActorKey(actor: SessionActor): string {
  return JSON.stringify([
    actor.kind,
    actor.hubOrigin ?? null,
    actor.organizationId ?? null,
    actor.connectionId ?? null,
    actor.id,
  ]);
}
export function sessionChannelKey(channel: SessionChannelReference): string {
  return JSON.stringify([
    channel.hubOrigin,
    channel.organizationId,
    channel.connectionId,
    channel.channelId,
  ]);
}

export interface AgentPermissionResponseRecord {
  id: string;
  timestamp: string;
  respondedBy?: SessionActor;
  request: AgentPermissionRequest;
  response: AgentPermissionResponse;
  toolCallId?: string;
  /** Exact committed source at admission; absence means standalone activity. */
  toolCallCursor?: { epoch: string; seq: number };
  status: "pending" | "applied" | "failed";
  error?: string;
}

export const SessionAuthorshipShape = {
  authorshipStatus: z.enum(["pending", "recovering", "ready", "error"]).optional(),
  createdBy: SessionActorSchema.optional(),
  lastMessageBy: SessionActorSchema.optional(),
  lastInteractionBy: SessionActorSchema.optional(),
  lastInteractionAt: z.string().optional(),
  participantActors: z.array(SessionActorSchema).optional(),
  channels: z.array(SessionChannelReferenceSchema).optional(),
};
export interface SessionAuthorship {
  authorshipStatus?: "pending" | "recovering" | "ready" | "error";
  createdBy?: SessionActor;
  lastMessageBy?: SessionActor;
  lastInteractionBy?: SessionActor;
  lastInteractionAt?: string;
  participantActors?: SessionActor[];
  channels?: SessionChannelReference[];
}

/** Only a verified Member snapshot permits app/channel grouping for participant filters. */
export function sessionParticipantKey(actor: SessionActor): string {
  return actor.memberId && actor.hubOrigin && actor.organizationId
    ? JSON.stringify(["member", actor.hubOrigin, actor.organizationId, actor.memberId])
    : sessionActorKey(actor);
}
