// upstream: extensions/zalo/src/webhook-spool.ts@5d8067a4483
// D-ZL-011: the spool's DURABILITY is replaced, its PARSING is not.
//
// Upstream opens OpenClaw's SQLite-backed `openChannelIngressQueue` for the
// account, appends the raw envelope, acks, and runs its own drain
// (`createChannelIngressMonitor` + retry policy + dead-letter + claim
// lifecycle). Fusion's Hub already owns exactly that store and that drain —
// `channel_ingress_queue` with lease/fencing, per-lane ordering, retry,
// dead-letter and restart drain (goal slices 1 and 8) — so running upstream's
// spool as well would be a second durable store for the same rows.
// `fusion/admission.ts` is the boundary: it keeps upstream's FLOW (persist the
// envelope, then ack — upstream 0ac69b9fe80) and hands the Hub queue the
// admission step the spool performs upstream.
//
// Everything that decides WHAT an envelope is stays here, verbatim: the zod
// schemas, the ok/result unwrapping, the admission facts (`message_id` as the
// event id, `chat:<id>` as the lane key), the post-admission identity check and
// the failure taxonomy the Hub's non-retryable classifier reads.
// Zalo plugin owns raw webhook durable admission and replay draining.
import { createChannelIngressError } from "@getpaseo/channels-core/plugin-sdk/channel-outbound";
import { normalizeNullableString as nonEmptyString } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";
import { z } from "zod";
import { ZaloApiError, type ZaloUpdate } from "./api.js";

export const ZALO_WEBHOOK_SPOOL_VERSION = 1;

export type ZaloWebhookSpoolPayload = {
  version: 1;
  rawEvent: string;
};

export const ZaloWebhookPayloadError = createChannelIngressError("ZaloWebhookPayloadError");
export type ZaloWebhookPayloadError = InstanceType<typeof ZaloWebhookPayloadError>;

const nonEmptyWebhookStringSchema = z
  .string()
  .transform((value) => nonEmptyString(value))
  .pipe(z.string());
const optionalWebhookStringSchema = z.string().optional().catch(undefined);
const webhookEnvelopeSchema = z
  .looseObject({
    ok: z.unknown().optional(),
    result: z.looseObject({}).optional().catch(undefined),
  })
  .transform((envelope) => (envelope.ok === true && envelope.result ? envelope.result : envelope));
const webhookAdmissionSchema = z.looseObject({
  message: z.looseObject({
    message_id: nonEmptyWebhookStringSchema,
    chat: z.looseObject({ id: nonEmptyWebhookStringSchema }),
  }),
});
const webhookSenderSchema = z.object({
  id: nonEmptyWebhookStringSchema,
  name: optionalWebhookStringSchema,
  display_name: optionalWebhookStringSchema,
  avatar: optionalWebhookStringSchema,
  is_bot: z.boolean().optional().catch(undefined),
});
const webhookChatSchema = z.object({
  id: nonEmptyWebhookStringSchema,
  chat_type: z.enum(["PRIVATE", "GROUP"]),
});
const webhookMessageSchema = z.object({
  message_id: nonEmptyWebhookStringSchema,
  from: webhookSenderSchema,
  chat: webhookChatSchema,
  date: z.number().finite(),
  text: optionalWebhookStringSchema,
  photo_url: optionalWebhookStringSchema,
  caption: optionalWebhookStringSchema,
  sticker: optionalWebhookStringSchema,
  message_type: optionalWebhookStringSchema,
});
const webhookUpdateSchema = z
  .object({
    event_name: z.enum([
      "message.text.received",
      "message.image.received",
      "message.sticker.received",
      "message.unsupported.received",
    ]),
    message: webhookMessageSchema,
  })
  .superRefine((update, context) => {
    if (update.event_name === "message.text.received" && update.message.text === undefined) {
      context.addIssue({
        code: "custom",
        path: ["message", "text"],
        message: "text event requires message.text",
      });
    }
  });

function parseRawRecord(rawEvent: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawEvent);
  } catch (error) {
    throw new ZaloWebhookPayloadError("Zalo webhook body contains invalid JSON.", { cause: error });
  }
  const envelope = webhookEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    throw new ZaloWebhookPayloadError("Zalo webhook body must be a JSON object.");
  }
  return envelope.data;
}

export function inspectZaloWebhookEvent(rawEvent: string): {
  eventId: string;
  laneKey: string;
  update: Record<string, unknown>;
} {
  const update = parseRawRecord(rawEvent);
  const admission = webhookAdmissionSchema.safeParse(update);
  if (!admission.success) {
    const missingEventId = admission.error.issues.some(
      (issue) =>
        issue.path[0] === "message" && (issue.path.length === 1 || issue.path[1] === "message_id"),
    );
    if (missingEventId) {
      throw new ZaloWebhookPayloadError("Zalo webhook message is missing message.message_id.");
    }
    const missingChatId = admission.error.issues.some(
      (issue) => issue.path[0] === "message" && issue.path[1] === "chat",
    );
    if (missingChatId) {
      throw new ZaloWebhookPayloadError("Zalo webhook message is missing message.chat.id.");
    }
    throw new ZaloWebhookPayloadError("Zalo webhook message is missing message.message_id.");
  }
  const eventId = admission.data.message.message_id;
  const chatId = admission.data.message.chat.id;
  return { eventId, laneKey: `chat:${chatId}`, update };
}

export function parseClaimedUpdate(payload: ZaloWebhookSpoolPayload, claimedId: string): ZaloUpdate {
  if (payload.version !== ZALO_WEBHOOK_SPOOL_VERSION || typeof payload.rawEvent !== "string") {
    throw new ZaloWebhookPayloadError("Zalo webhook spool payload is invalid.");
  }
  const facts = inspectZaloWebhookEvent(payload.rawEvent);
  if (facts.eventId !== claimedId) {
    throw new ZaloWebhookPayloadError("Zalo webhook message id changed after durable admission.");
  }
  const parsed = webhookUpdateSchema.safeParse(facts.update);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join("."));
    if (paths.some((path) => path === "event_name")) {
      throw new ZaloWebhookPayloadError("Zalo webhook event_name is unsupported.");
    }
    if (paths.some((path) => path === "message.from" || path.startsWith("message.from.id"))) {
      throw new ZaloWebhookPayloadError("Zalo webhook message is missing message.from.id.");
    }
    if (paths.some((path) => path === "message.chat" || path.startsWith("message.chat.id"))) {
      throw new ZaloWebhookPayloadError("Zalo webhook message is missing message.chat.id.");
    }
    if (paths.some((path) => path.startsWith("message.chat.chat_type"))) {
      throw new ZaloWebhookPayloadError("Zalo webhook message has an invalid chat type.");
    }
    if (paths.some((path) => path.startsWith("message.date"))) {
      throw new ZaloWebhookPayloadError("Zalo webhook message has an invalid date.");
    }
    if (paths.some((path) => path.startsWith("message.text"))) {
      throw new ZaloWebhookPayloadError("Zalo text event is missing message.text.");
    }
    throw new ZaloWebhookPayloadError("Zalo webhook event_name is unsupported.");
  }
  const { event_name: eventName, message } = parsed.data;
  return {
    event_name: eventName,
    message: {
      message_id: claimedId,
      from: message.from,
      chat: message.chat,
      date: message.date,
      ...(message.text !== undefined ? { text: message.text } : {}),
      ...(message.photo_url !== undefined ? { photo_url: message.photo_url } : {}),
      ...(message.caption !== undefined ? { caption: message.caption } : {}),
      ...(message.sticker !== undefined ? { sticker: message.sticker } : {}),
      ...(message.message_type !== undefined ? { message_type: message.message_type } : {}),
    },
  };
}

export function isZaloAuthenticationFailure(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      cause?: unknown;
      errorCode?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    if (
      (current instanceof ZaloApiError &&
        (current.errorCode === 401 || current.errorCode === 403)) ||
      candidate.status === 401 ||
      candidate.status === 403 ||
      candidate.statusCode === 401 ||
      candidate.statusCode === 403
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
