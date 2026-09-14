import { z } from "zod";
import { SessionActorSchema, SessionChannelReferenceSchema } from "./session-authorship.js";

export const SessionOperationIdentitySchema = z.object({
  actor: SessionActorSchema,
  channel: SessionChannelReferenceSchema.optional(),
});
export type VerifiedSessionOperationIdentity = z.infer<typeof SessionOperationIdentitySchema>;

/** Stable JSON for a validated operation; correlation IDs are not logical message IDs. */
export function sessionOperationContent(message: Record<string, unknown>): string {
  const copy = { ...message };
  delete copy.sessionOperationTicket;
  if (copy.type !== "agent_permission_response") delete copy.requestId;
  return canonicalJson(copy);
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
