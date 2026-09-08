// Fusion-owned webhook receive mode (D-GC-014).
//
// UNEXERCISED IN PRODUCTION: Google Chat needs a public HTTPS endpoint the dev
// host does not have, so no live scenario runs this. It is wired, typechecked
// and unit-tested against a real `node:http` listener with a fake verifier, and
// nothing else. Do not report Google Chat inbound as verified.
//
// Upstream binds its webhook path on OpenClaw's process-wide gateway HTTP
// server (`monitor-routing.ts` → `registerWebhookTargetWithPluginRoute` →
// `src/plugins/http-registry.ts`, D-CORE-321). Fusion has no such server, so
// this module owns one `node:http` listener per account and keeps everything
// else upstream: the path is canonicalized and matched through the ported
// target registry, the ported request pipeline runs the method / content-type /
// rate-limit / in-flight guards, and the ported
// `createGoogleChatWebhookRequestHandler` owns bearer extraction, the
// pre-auth-vs-post-auth body-read profiles, target selection by verified
// audience, and — the invariant this mode exists for — a 200 only AFTER the
// event is durably admitted, with a 503 otherwise so Google redelivers.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import {
  canonicalizeWebhookRouteKey,
  createFixedWindowRateLimiter,
  createWebhookInFlightLimiter,
  registerWebhookTarget,
  resolveWebhookPath,
  WEBHOOK_RATE_LIMIT_DEFAULTS,
} from "@getpaseo/channels-core/plugin-sdk/webhook-ingress";
import type { HostChildLogger } from "@getpaseo/channels-shared";
import type { WebhookTarget } from "../monitor-types.js";
import { createGoogleChatWebhookRequestHandler } from "../monitor-webhook.js";
import type { GoogleChatEvent } from "../types.js";

/** The account config fields that place the account's webhook endpoint. */
export interface GoogleChatWebhookMode {
  /** The request path Google posts to (upstream default `/googlechat`). */
  path: string;
  /** The listen port for the owned `node:http` server; 0 = ephemeral. */
  port: number;
  host?: string;
}

/**
 * Reads webhook placement out of an account's config. `null` = the configured
 * `webhookUrl` does not parse, which upstream treats as "no route was bound"
 * rather than falling back to the default path — reporting a path nothing binds
 * would make a broken account read as healthy.
 */
export function resolveGoogleChatWebhookMode(config: {
  webhookPath?: unknown;
  webhookUrl?: unknown;
  webhookPort?: unknown;
  webhookHost?: unknown;
}): GoogleChatWebhookMode | null {
  const path = resolveWebhookPath({
    ...(typeof config.webhookPath === "string" ? { webhookPath: config.webhookPath } : {}),
    ...(typeof config.webhookUrl === "string" ? { webhookUrl: config.webhookUrl } : {}),
    defaultPath: "/googlechat",
  });
  if (path === null) return null;
  return {
    path,
    port: typeof config.webhookPort === "number" ? config.webhookPort : 0,
    ...(typeof config.webhookHost === "string" && config.webhookHost !== ""
      ? { host: config.webhookHost }
      : {}),
  };
}

// One rate limiter and one in-flight limiter per process, as upstream's
// `monitor-routing.ts` has: the bucket key already carries the path and the
// client ip, so accounts sharing a path share a budget on purpose.
const webhookRateLimiter = createFixedWindowRateLimiter({
  windowMs: WEBHOOK_RATE_LIMIT_DEFAULTS.windowMs,
  maxRequests: WEBHOOK_RATE_LIMIT_DEFAULTS.maxRequests,
  maxTrackedKeys: WEBHOOK_RATE_LIMIT_DEFAULTS.maxTrackedKeys,
});
const webhookInFlightLimiter = createWebhookInFlightLimiter();

export interface GoogleChatWebhookSessionOptions {
  target: WebhookTarget;
  webhook: GoogleChatWebhookMode;
  abortSignal: AbortSignal;
  logger?: HostChildLogger;
  setStatus?: (patch: Record<string, unknown>) => void;
  /** Non-turn events (upstream's detached path). Absent = they are dropped. */
  processEvent?: (event: GoogleChatEvent, target: WebhookTarget) => Promise<void>;
  /** Reports the bound port once the listener is up (port 0 = ephemeral). */
  onListening?: (port: number) => void;
  /** Test seam: an existing server to attach to instead of creating one. */
  createServerImpl?: typeof createServer;
}

/** Runs until `abortSignal` fires. */
export async function startGoogleChatWebhookSession(
  options: GoogleChatWebhookSessionOptions,
): Promise<void> {
  const targetsByPath = new Map<string, WebhookTarget[]>();
  const registration = registerWebhookTarget(targetsByPath, {
    ...options.target,
    path: canonicalizeWebhookRouteKey(options.webhook.path),
  });
  const handler = createGoogleChatWebhookRequestHandler({
    webhookTargets: targetsByPath,
    webhookRateLimiter,
    webhookInFlightLimiter,
    processEvent: async (event, target) => {
      await options.processEvent?.(event, target);
    },
  });
  const server = (options.createServerImpl ?? createServer)((req, res) => {
    void dispatch(handler, options.logger, req, res);
  });
  await listen(server, options.webhook.port, options.webhook.host);
  const address = server.address();
  if (options.onListening !== undefined && address !== null && typeof address === "object") {
    options.onListening(address.port);
  }
  options.setStatus?.({
    mode: "webhook",
    connected: true,
    webhookPath: registration.target.path,
    lastConnectedAt: Date.now(),
  });
  try {
    await waitForAbort(options.abortSignal);
  } finally {
    options.setStatus?.({ mode: "webhook", connected: false });
    registration.unregister();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function dispatch(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
  logger: HostChildLogger | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const handled = await handler(req, res);
    if (!handled && !res.headersSent) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    }
  } catch (error) {
    // A fault before the handler answered is NOT an acknowledgement: 500 keeps
    // Google redelivering, which is the same rule the admission path follows.
    logger?.warn("googlechat webhook request failed", { error: formatErrorMessage(error) });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("internal error");
    } else {
      res.end();
    }
  }
}

function listen(server: Server, port: number, host?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    if (host === undefined) server.listen(port, () => resolve());
    else server.listen(port, host, () => resolve());
  });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
