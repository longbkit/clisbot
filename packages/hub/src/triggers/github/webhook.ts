import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedGitHubEvent } from "../../auth/github-events.js";
import { WebhookPayloadSchema } from "../../auth/github-events.js";
import type { WebhookPayload } from "../../auth/github-events.js";
import { isDatabaseUnavailableError } from "../../db/errors.js";
import type { ProviderEventAcceptance } from "../../db/types.js";
import { reportFailure } from "../../failures/index.js";
import { logger } from "../../logger.js";
import { readBoundedRequestBody } from "../../http/request-body.js";
import type { TriggerHandler, TriggerSource } from "../index.js";
import type { ProviderEventDropReasonCode } from "../drop-reason.js";
import { logProviderEventIntake } from "../audit.js";

const MAX_WEBHOOK_BYTES = 1_048_576;
const MAX_HEADER_LENGTH = 128;

export interface WebhookSourceOptions {
  accept(input: {
    installationId: number;
    repositoryId?: number;
    deliveryId: string;
    signatureHash: string;
    source: string;
    repo?: string | null;
    payload: unknown;
    receivedAt: Date;
    dropReason?: ProviderEventDropReasonCode;
  }): Promise<ProviderEventAcceptance>;
  applyLifecycle(input: {
    installationId: number;
    event: "installation" | "installation_repositories";
    deliveryId: string;
    signatureHash: string;
    source: string;
    payload: unknown;
    receivedAt: Date;
  }): Promise<void>;
  synchronizePush?(input: {
    installationId: number;
    repositoryId: number;
    deliveryId: string;
    payload: unknown;
  }): Promise<void>;
}

export interface WebhookEndpoint extends TriggerSource {
  handle(request: Request): Promise<Response>;
}

interface VerifiedWebhook {
  body: WebhookPayload;
  deliveryId: string;
  eventType: string;
  signatureHash: string;
}

/**
 * @param secret the App's webhook secret, or `undefined` when event triggers are not set up.
 * Without a secret there is nothing to check a signature against, so every delivery is refused
 * rather than trusted — an unconfigured endpoint must not become an unauthenticated one.
 */
export function createWebhookSource(
  secret: string | undefined,
  options: WebhookSourceOptions,
): WebhookEndpoint {
  const handlers = new Set<TriggerHandler>();

  async function handle(request: Request): Promise<Response> {
    if (secret === undefined) {
      reportGitHubRejection("webhook_secret_unconfigured", 503);
      return new Response("Service Unavailable", { status: 503 });
    }
    const verified = await verifyWebhookRequest(request, secret);
    if (verified instanceof Response) return verified;

    try {
      return await handleVerifiedWebhook(verified, options, handlers);
    } catch (error) {
      reportFailure(
        error,
        {
          operation: "github.webhook.handle",
          component: "triggers",
          provider: "github",
          status: isDatabaseUnavailableError(error) ? 503 : 500,
        },
        {
          status: isDatabaseUnavailableError(error) ? 503 : 500,
          scrubValues: secret === undefined ? [] : [secret],
        },
      );
      if (isDatabaseUnavailableError(error)) {
        return Response.json({ error: "database_unavailable" }, { status: 503 });
      }
      return Response.json({ error: "webhook_processing_failed" }, { status: 500 });
    }
  }

  return {
    handle,
    async start(nextHandler: TriggerHandler): Promise<void> {
      handlers.add(nextHandler);
    },
    async stop(): Promise<void> {
      handlers.clear();
    },
  };
}

async function handleVerifiedWebhook(
  verified: VerifiedWebhook,
  options: WebhookSourceOptions,
  handlers: Set<TriggerHandler>,
): Promise<Response> {
  const { body, deliveryId, eventType, signatureHash } = verified;
  const installationId = body.installation?.id;
  if (typeof installationId !== "number") {
    reportGitHubRejection("installation_id_missing", 400);
    return new Response("Bad Request", { status: 400 });
  }

  if (eventType === "installation" || eventType === "installation_repositories") {
    return handleLifecycle(options, verified, installationId, eventType);
  }

  const event = normalizeWebhookEvent({ body, deliveryId, eventType });
  if (event === undefined) {
    logger.info({ deliveryId, eventType }, "skipping webhook event without repo or installation");
    const acceptance = await options.accept({
      installationId,
      deliveryId,
      signatureHash,
      source: `github.${eventType}`,
      payload: body,
      receivedAt: new Date(),
      dropReason: "no_trigger_for_source",
    });
    logProviderEventIntake({
      provider: "github",
      source: `github.${eventType}`,
      deliveryId,
      acceptance,
    });
    return new Response("OK", { status: 200 });
  }

  const acceptance = await options.accept({
    installationId: event.installationId,
    repositoryId: event.repositoryId,
    deliveryId,
    signatureHash,
    source: `github.${eventType}`,
    repo: event.repo,
    payload: event,
    receivedAt: new Date(event.createdAt),
    ...(handlers.size === 0 ? { dropReason: "configuration_unavailable" } : {}),
  });
  logProviderEventIntake({
    provider: "github",
    source: `github.${eventType}`,
    deliveryId,
    repository: event.repo,
    resourceId: String(event.repositoryId),
    acceptance,
  });
  if (eventType === "push" && options.synchronizePush !== undefined) {
    await options.synchronizePush({
      installationId: event.installationId,
      repositoryId: event.repositoryId,
      deliveryId,
      payload: body,
    });
  }

  if (acceptance.status !== "accepted") return new Response("OK", { status: 200 });

  return dispatchWebhook(handlers, acceptance.events);
}

async function verifyWebhookRequest(
  request: Request,
  secret: string,
): Promise<VerifiedWebhook | Response> {
  const signature = request.headers.get("X-Hub-Signature-256") ?? undefined;

  if (signature === undefined) {
    reportGitHubRejection("signature_header_missing", 401, secret);
    return new Response("Unauthorized", { status: 401 });
  }

  const captured = await readBoundedRequestBody(request, MAX_WEBHOOK_BYTES);
  if (captured instanceof Response) return captured;

  if (!verifySignature(secret, captured, signature)) {
    reportGitHubRejection("signature_verification_failed", 401, secret, signature);
    return new Response("Unauthorized", { status: 401 });
  }

  const signatureHash = hashWebhookSignature(signature);
  const eventType = request.headers.get("X-GitHub-Event") ?? undefined;
  const deliveryId = request.headers.get("X-GitHub-Delivery") ?? undefined;

  if (
    eventType === undefined ||
    deliveryId === undefined ||
    eventType.length > MAX_HEADER_LENGTH ||
    deliveryId.length > MAX_HEADER_LENGTH ||
    eventType.length === 0 ||
    deliveryId.length === 0
  ) {
    reportGitHubRejection("required_headers_missing", 400, secret, signature);
    return new Response("Bad Request", { status: 400 });
  }

  let rawJson: unknown;

  try {
    rawJson = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(captured));
  } catch (error) {
    reportFailure(
      error,
      { operation: "github.webhook.parse", component: "triggers", provider: "github", status: 400 },
      { status: 400, scrubValues: [secret, signature] },
    );
    return Response.json({ error: "request body must be valid JSON" }, { status: 400 });
  }

  const parsedBody = WebhookPayloadSchema.safeParse(rawJson);

  if (!parsedBody.success) {
    reportGitHubRejection("invalid_payload", 400, secret, signature);
    return Response.json(
      { error: "invalid webhook payload", issues: parsedBody.error.format() },
      { status: 400 },
    );
  }

  return { body: parsedBody.data, deliveryId, eventType, signatureHash };
}

/** A refused delivery is an unsigned one (401), an unconfigured endpoint (503), or malformed. */
function rejectionKind(status: number): "authentication" | "conflict" | "validation" {
  if (status === 401) return "authentication";
  if (status === 503) return "conflict";
  return "validation";
}

function reportGitHubRejection(
  reason: string,
  status: number,
  secret?: string,
  signature?: string,
): void {
  reportFailure(
    Object.assign(new Error("GitHub webhook request rejected"), { code: reason }),
    { operation: "github.webhook.verify", component: "triggers", provider: "github", status },
    {
      status,
      kind: rejectionKind(status),
      scrubValues: [
        ...(secret === undefined ? [] : [secret]),
        ...(signature === undefined ? [] : [signature]),
      ],
    },
  );
}

async function handleLifecycle(
  options: WebhookSourceOptions,
  webhook: VerifiedWebhook,
  installationId: number,
  eventType: "installation" | "installation_repositories",
): Promise<Response> {
  await options.applyLifecycle({
    installationId,
    event: eventType,
    deliveryId: webhook.deliveryId,
    signatureHash: webhook.signatureHash,
    source: `github.${webhook.eventType}`,
    payload: webhook.body,
    receivedAt: new Date(),
  });
  logger.info(
    {
      provider: "github",
      source: `github.${webhook.eventType}`,
      deliveryId: webhook.deliveryId,
      installationId,
    },
    "provider lifecycle event applied",
  );
  return new Response("OK", { status: 200 });
}

async function dispatchWebhook(
  handlers: Set<TriggerHandler>,
  triggers: readonly Parameters<TriggerHandler>[0][],
): Promise<Response> {
  await Promise.all(
    triggers.flatMap((trigger) => Array.from(handlers, (handler) => handler(trigger))),
  );

  return new Response("OK", { status: 200 });
}

export function verifySignature(
  secret: string,
  payload: string | Uint8Array,
  signature: string,
): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

  if (expected.length !== signature.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function hashWebhookSignature(signature: string): string {
  return createHash("sha256").update(signature).digest("hex");
}

export function normalizeWebhookEvent(options: {
  body: WebhookPayload;
  deliveryId: string;
  eventType: string;
}): NormalizedGitHubEvent | undefined {
  const repo = options.body.repository?.full_name;
  const repositoryId = options.body.repository?.id;
  const installationId = options.body.installation?.id;

  if (typeof repo !== "string" || repo.length === 0) {
    return undefined;
  }

  if (typeof installationId !== "number") {
    return undefined;
  }

  if (typeof repositoryId !== "number") {
    return undefined;
  }

  return {
    id: options.deliveryId,
    type: options.eventType,
    repo,
    repositoryId,
    installationId,
    payload: options.body,
    createdAt: new Date().toISOString(),
  };
}
