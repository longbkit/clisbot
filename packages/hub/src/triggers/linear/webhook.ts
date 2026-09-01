import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ProviderEventAcceptance } from "../../db/types.js";
import { readBoundedRequestBody } from "../../http/request-body.js";
import { logger } from "../../logger.js";
import { logProviderEventIntake } from "../audit.js";
import type { ProviderEventDropReasonCode } from "../drop-reason.js";
import type { TriggerHandler, TriggerSource } from "../index.js";
import { eventIssueId, eventProjectId, normalizeLinearEvent } from "./events.js";
import type { LinearIssueDetails } from "../../providers/linear/client.js";

const MAX_WEBHOOK_BYTES = 1_048_576;
const MAX_TIMESTAMP_SKEW_MS = 60_000;

export interface LinearWebhookSourceOptions {
  signingSecret: string;
  now?: () => number;
  canHydrateIssue?(linearOrganizationId: string): Promise<boolean>;
  resolveIssue?(input: {
    linearOrganizationId: string;
    issueId: string;
  }): Promise<LinearIssueDetails | undefined>;
  accept(input: {
    linearOrganizationId: string;
    projectId?: string;
    deliveryId: string;
    signatureHash: string;
    source: string;
    payload: unknown;
    receivedAt: Date;
    dropReason?: ProviderEventDropReasonCode;
  }): Promise<ProviderEventAcceptance>;
}

export interface LinearWebhookEndpoint extends TriggerSource {
  handle(request: Request): Promise<Response>;
}

interface VerifiedLinearRequest {
  deliveryId: string;
  eventName: string | null;
  payload: unknown;
  signatureHash: string;
  receivedAt: Date;
}

export function createLinearWebhookSource(
  options: LinearWebhookSourceOptions,
): LinearWebhookEndpoint {
  const handlers = new Set<TriggerHandler>();
  return {
    async handle(request) {
      const verified = await verifyLinearRequest(request, options);
      if (verified instanceof Response) return verified;
      return handoffLinearEvent(verified, handlers, options);
    },
    async start(handler) {
      handlers.add(handler);
    },
    async stop() {
      handlers.clear();
    },
  };
}

async function verifyLinearRequest(
  request: Request,
  options: Pick<LinearWebhookSourceOptions, "signingSecret" | "now">,
): Promise<VerifiedLinearRequest | Response> {
  const deliveryId = request.headers.get("linear-delivery");
  const signature = request.headers.get("linear-signature");
  if (deliveryId === null || signature === null) {
    logger.warn("rejecting Linear event because signature evidence is missing");
    return new Response("Unauthorized", { status: 401 });
  }
  const body = await readBoundedRequestBody(request, MAX_WEBHOOK_BYTES);
  if (body instanceof Response) return body;
  const normalizedSignature = canonicalLinearSignature(signature);
  if (
    normalizedSignature === undefined ||
    !verifyLinearSignature(options.signingSecret, body, normalizedSignature)
  ) {
    logger.warn("rejecting Linear event because signature verification failed");
    return new Response("Unauthorized", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    logger.warn("rejecting Linear event because payload is invalid JSON");
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }
  const receivedAt = new Date(options.now?.() ?? Date.now());
  if (!verifyLinearWebhookTimestamp(payload, receivedAt.getTime())) {
    logger.warn("rejecting Linear event because its signed webhook timestamp is stale or invalid");
    return new Response("Unauthorized", { status: 401 });
  }
  return {
    deliveryId,
    eventName: request.headers.get("linear-event"),
    payload,
    signatureHash: createHash("sha256").update(normalizedSignature).digest("hex"),
    receivedAt,
  };
}

async function handoffLinearEvent(
  verified: VerifiedLinearRequest,
  handlers: Set<TriggerHandler>,
  options: LinearWebhookSourceOptions,
): Promise<Response> {
  try {
    let event = normalizeLinearEvent(verified.payload, verified.eventName);
    if (event === undefined) {
      logger.info({ deliveryId: verified.deliveryId }, "ignoring unsupported Linear event");
      return new Response("OK", { status: 200 });
    }
    if (eventProjectId(event) === undefined && options.resolveIssue !== undefined) {
      const source = linearEventSource(event);
      if (
        options.canHydrateIssue !== undefined &&
        !(await options.canHydrateIssue(event.organizationId))
      ) {
        return await acceptAndDispatchLinearEvent(event, source, verified, handlers, options, true);
      }
      const issue = await options.resolveIssue({
        linearOrganizationId: event.organizationId,
        issueId: eventIssueId(event),
      });
      event = normalizeLinearEvent(verified.payload, verified.eventName, issue);
    }
    if (event === undefined) {
      logger.warn({ deliveryId: verified.deliveryId }, "Linear event issue hydration was invalid");
      return Response.json({ error: "invalid_linear_event" }, { status: 400 });
    }
    return await acceptAndDispatchLinearEvent(
      event,
      linearEventSource(event),
      verified,
      handlers,
      options,
    );
  } catch (error) {
    logger.error({ err: error, deliveryId: verified.deliveryId }, "Linear event handoff failed");
    return Response.json({ error: "event_handoff_unavailable" }, { status: 503 });
  }
}

async function acceptAndDispatchLinearEvent(
  event: NonNullable<ReturnType<typeof normalizeLinearEvent>>,
  source: "linear.issue" | "linear.comment",
  verified: VerifiedLinearRequest,
  handlers: Set<TriggerHandler>,
  options: LinearWebhookSourceOptions,
  preserveBindingDrop = false,
): Promise<Response> {
  const projectId = eventProjectId(event);
  const acceptance = await options.accept({
    linearOrganizationId: event.organizationId,
    ...(projectId === undefined ? {} : { projectId }),
    deliveryId: verified.deliveryId,
    signatureHash: verified.signatureHash,
    source,
    payload: event,
    receivedAt: verified.receivedAt,
    ...(handlers.size === 0 && !preserveBindingDrop
      ? { dropReason: "configuration_unavailable" }
      : {}),
  });
  logProviderEventIntake({
    provider: "linear",
    source,
    deliveryId: verified.deliveryId,
    resourceId: projectId,
    acceptance,
  });
  const events = acceptance.status === "accepted" ? acceptance.events : [];
  await Promise.all(
    events.flatMap((acceptedEvent) => Array.from(handlers, (handler) => handler(acceptedEvent))),
  );
  return new Response("OK", { status: 200 });
}

function linearEventSource(
  event: NonNullable<ReturnType<typeof normalizeLinearEvent>>,
): "linear.issue" | "linear.comment" {
  return event.type === "issue" ? "linear.issue" : "linear.comment";
}

/** Verify Linear's HMAC-SHA256 over the exact raw request body. */
export function verifyLinearSignature(
  secret: string,
  body: string | Uint8Array,
  signature: string,
): boolean {
  const normalizedSignature = canonicalLinearSignature(signature);
  if (normalizedSignature === undefined) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(normalizedSignature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A verified signature's spelling is not evidence; its normalized bytes are. */
function canonicalLinearSignature(signature: string): string | undefined {
  const unprefixed = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  return /^[a-f0-9]{64}$/iu.test(unprefixed) ? unprefixed.toLowerCase() : undefined;
}

/** The timestamp is inside the HMAC-protected body, so it can safely prevent replay. */
export function verifyLinearWebhookTimestamp(
  payload: unknown,
  nowMilliseconds = Date.now(),
): boolean {
  if (!isRecord(payload)) return false;
  const timestampMilliseconds = parseLinearWebhookTimestamp(payload["webhookTimestamp"]);
  return (
    timestampMilliseconds !== undefined &&
    Math.abs(nowMilliseconds - timestampMilliseconds) <= MAX_TIMESTAMP_SKEW_MS
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLinearWebhookTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return undefined;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) ? timestamp : undefined;
}
