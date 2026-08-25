import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ProviderEventAcceptance } from "../../db/types.js";
import { reportFailure } from "../../failures/index.js";
import { readBoundedRequestBody } from "../../http/request-body.js";
import type { TriggerHandler, TriggerSource } from "../index.js";
import type { ProviderEventDropReasonCode } from "../drop-reason.js";
import { intakeSlackEvent, SlackEventIntakeValidationError } from "./source/internal/intake.js";
import { SlackUrlVerificationSchema } from "./events.js";

const MAX_WEBHOOK_BYTES = 1_048_576;
const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;
const SlackEnvelopeTypeSchema = z.object({ type: z.string() }).passthrough();

export interface SlackWebhookSourceOptions {
  appId: string;
  signingSecret: string;
  now?: () => number;
  accept(input: {
    teamId: string;
    deliveryId: string;
    signatureHash: string;
    source: string;
    payload: unknown;
    receivedAt: Date;
    dropReason?: ProviderEventDropReasonCode;
  }): Promise<ProviderEventAcceptance>;
}

export interface SlackWebhookEndpoint extends TriggerSource {
  handle(request: Request): Promise<Response>;
}

interface VerifiedSlackRequest {
  payload: unknown;
  signatureHash: string;
}

export function createSlackWebhookSource(options: SlackWebhookSourceOptions): SlackWebhookEndpoint {
  const handlers = new Set<TriggerHandler>();

  return {
    async handle(request) {
      const verified = await verifySlackRequest(request, options);
      if (verified instanceof Response) return verified;
      return handleVerifiedSlackRequest(verified, handlers, options);
    },
    async start(handler) {
      handlers.add(handler);
    },
    async stop() {
      handlers.clear();
    },
  };
}

async function verifySlackRequest(
  request: Request,
  options: Pick<SlackWebhookSourceOptions, "signingSecret" | "now">,
): Promise<VerifiedSlackRequest | Response> {
  const signature = request.headers.get("x-slack-signature");
  const timestamp = request.headers.get("x-slack-request-timestamp");
  if (signature === null || timestamp === null) {
    reportSlackRejection("signature_headers_missing", 401, options.signingSecret);
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await readBoundedRequestBody(request, MAX_WEBHOOK_BYTES);
  if (body instanceof Response) return body;
  if (!verifySlackSignature(options.signingSecret, timestamp, body, signature, options.now?.())) {
    reportSlackRejection("signature_verification_failed", 401, options.signingSecret, signature);
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    reportFailure(
      error,
      { operation: "slack.webhook.parse", component: "triggers", provider: "slack", status: 400 },
      { status: 400, scrubValues: [options.signingSecret] },
    );
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  return { payload, signatureHash: createHash("sha256").update(signature).digest("hex") };
}

async function handleVerifiedSlackRequest(
  verified: VerifiedSlackRequest,
  handlers: Set<TriggerHandler>,
  options: SlackWebhookSourceOptions,
): Promise<Response> {
  const envelopeType = SlackEnvelopeTypeSchema.safeParse(verified.payload);
  if (!envelopeType.success) {
    reportSlackRejection("invalid_envelope", 400, options.signingSecret);
    return new Response("Bad Request", { status: 400 });
  }

  if (envelopeType.data.type === "url_verification") {
    const challenge = SlackUrlVerificationSchema.safeParse(verified.payload);
    if (!challenge.success || !matchesConfiguredApp(challenge.data.api_app_id, options.appId)) {
      reportSlackRejection("invalid_url_verification", 400, options.signingSecret);
      return new Response("Bad Request", { status: 400 });
    }
    return Response.json({ challenge: challenge.data.challenge });
  }

  if (envelopeType.data.type !== "event_callback") {
    return new Response("OK", { status: 200 });
  }
  try {
    await intakeSlackEvent(verified.payload, verified.signatureHash, handlers, options);
    return new Response("OK", { status: 200 });
  } catch (error) {
    if (error instanceof SlackEventIntakeValidationError) {
      reportSlackRejection("invalid_callback", 400, options.signingSecret);
      return new Response("Bad Request", { status: 400 });
    }
    reportFailure(
      error,
      {
        operation: "slack.webhook.handoff",
        component: "triggers",
        provider: "slack",
        status: 503,
      },
      { status: 503, scrubValues: [options.signingSecret] },
    );
    return Response.json({ error: "event_handoff_unavailable" }, { status: 503 });
  }
}

function reportSlackRejection(
  reason: string,
  status: number,
  signingSecret: string,
  signature?: string,
): void {
  reportFailure(
    Object.assign(new Error("Slack webhook request rejected"), { code: reason }),
    { operation: "slack.webhook.verify", component: "triggers", provider: "slack", status },
    {
      status,
      kind: status === 401 ? "authentication" : "validation",
      scrubValues: [signingSecret, ...(signature === undefined ? [] : [signature])],
    },
  );
}

function matchesConfiguredApp(requestAppId: string | undefined, configuredAppId: string): boolean {
  return requestAppId === undefined || requestAppId === configuredAppId;
}

export function verifySlackSignature(
  secret: string,
  timestamp: string,
  body: string | Uint8Array,
  signature: string,
  nowMilliseconds = Date.now(),
): boolean {
  if (!/^\d+$/u.test(timestamp) || !/^v0=[a-f0-9]{64}$/u.test(signature)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)) return false;
  const nowSeconds = Math.floor(nowMilliseconds / 1_000);
  if (Math.abs(nowSeconds - seconds) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update("v0:")
    .update(timestamp)
    .update(":")
    .update(body)
    .digest();
  const actual = Buffer.from(signature.slice(3), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
