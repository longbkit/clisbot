import { z } from "zod";
import type { RawData } from "ws";

const SlackId = z.string().min(1).max(255);

export const SlackSocketHelloSchema = z.object({
  type: z.literal("hello"),
  connection_info: z.object({ app_id: SlackId }),
  num_connections: z.number().int().positive().optional(),
});

export const SlackSocketDisconnectSchema = z.object({
  type: z.literal("disconnect"),
  reason: z.enum(["warning", "refresh_requested", "link_disabled"]),
});

export const SlackSocketEnvelopeSchema = z.object({
  type: z.string().min(1).max(255),
  envelope_id: SlackId,
  payload: z.unknown(),
  accepts_response_payload: z.boolean().optional(),
});

export const SlackSocketOpenResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().max(255).optional(),
  url: z.string().url().optional(),
});

export function slackSocketAck(envelopeId: string): string {
  return JSON.stringify({ envelope_id: envelopeId });
}

export function slackSocketFrame(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return data;
}

export function parseSlackSocketFrame(data: RawData): unknown {
  try {
    return JSON.parse(slackSocketFrame(data).toString("utf8"));
  } catch {
    return undefined;
  }
}
