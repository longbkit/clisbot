// Fusion-owned webhook receive mode (D-ZL-014).
//
// UNEXERCISED IN PRODUCTION: Zalo posts updates to a public HTTPS URL the dev
// host does not have, so no live scenario runs this. It is wired, typechecked
// and unit-tested against a real `node:http` listener, and nothing else. Do not
// report Zalo webhook inbound as verified.
//
// Upstream binds its webhook path on OpenClaw's process-wide gateway HTTP
// server (`monitor.ts` → `registerWebhookTargetWithPluginRoute` →
// `src/plugins/http-registry.ts`, `@getpaseo/channels-core` D-CORE-321). Fusion
// has no such server, so this module owns one `node:http` listener per account
// and keeps everything else upstream: the target is registered through the
// ported registry, the ported `handleZaloWebhookRequest` owns the guards, the
// constant-time secret compare, the bounded body read and — the invariant this
// mode exists for — a 200 written only AFTER `acceptWebhook` resolves
// (upstream 0ac69b9fe80, "ACK webhook only after spool"), with a 500 otherwise
// so Zalo redelivers and a 400 for a payload that can never parse.
//
// Upstream's `setWebhook` on start and `deleteWebhook` on stop are kept here
// because they belong to the transport's lifetime, including the 5s cleanup
// budget so a stuck delete cannot hold a shutdown.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import { resolveWebhookPath } from "@getpaseo/channels-core/plugin-sdk/webhook-ingress";
import type { HostChildLogger } from "@getpaseo/channels-shared";
import { deleteWebhook, setWebhook, type ZaloFetch } from "../api.js";
import { zaloWebhookRuntime } from "../monitor.webhook.js";
import type { ResolvedZaloAccount } from "../accounts.js";
import type { ZaloRuntimeEnv } from "../monitor.types.js";
import type { OpenClawConfig } from "../runtime-api.js";
import { ZaloWebhookPayloadError } from "../webhook-spool.js";
import type { ZaloAdmission } from "./admission.js";

/** Upstream `monitor.ts`: the webhook-delete budget on shutdown. */
const WEBHOOK_CLEANUP_TIMEOUT_MS = 5_000;

/** The account config fields that place the account's webhook endpoint. */
export interface ZaloWebhookMode {
  /** The request path Zalo posts to. */
  path: string;
  /** The public HTTPS URL registered with `setWebhook`. */
  webhookUrl: string;
  /** The listen port for the owned `node:http` server; 0 = ephemeral. */
  port: number;
  host?: string;
}

/**
 * Reads webhook placement out of an account's config. `null` = the account is
 * not in webhook mode (no `webhookUrl`) or the URL does not parse — upstream
 * treats an underivable path as "no route was bound" rather than falling back
 * to a default, because reporting a path nothing binds makes a broken account
 * read as healthy.
 */
export function resolveZaloWebhookMode(config: {
  webhookUrl?: unknown;
  webhookPath?: unknown;
  webhookPort?: unknown;
  webhookHost?: unknown;
}): ZaloWebhookMode | null {
  const webhookUrl = typeof config.webhookUrl === "string" ? config.webhookUrl.trim() : "";
  if (webhookUrl === "") return null;
  const path = resolveWebhookPath({
    ...(typeof config.webhookPath === "string" ? { webhookPath: config.webhookPath } : {}),
    webhookUrl,
    defaultPath: null,
  });
  if (path === null) return null;
  return {
    path,
    webhookUrl,
    port: typeof config.webhookPort === "number" ? config.webhookPort : 0,
    ...(typeof config.webhookHost === "string" && config.webhookHost !== ""
      ? { host: config.webhookHost }
      : {}),
  };
}

export interface ZaloWebhookSessionOptions {
  account: ResolvedZaloAccount;
  cfg: OpenClawConfig;
  token: string;
  webhook: ZaloWebhookMode;
  webhookSecret: string;
  admission: ZaloAdmission;
  abortSignal: AbortSignal;
  runtime?: ZaloRuntimeEnv;
  logger?: HostChildLogger;
  fetcher?: ZaloFetch;
  setStatus?: (patch: Record<string, unknown>) => void;
  /** Reports the bound port once the listener is up (port 0 = ephemeral). */
  onListening?: (port: number) => void;
  /** Test seam: an existing server factory to attach to. */
  createServerImpl?: typeof createServer;
  /** Test seam: skip the `setWebhook` / `deleteWebhook` round trips. */
  skipWebhookRegistration?: boolean;
}

/** Upstream's webhook-mode preconditions, unchanged. */
export function assertZaloWebhookMode(params: {
  webhookUrl: string;
  webhookSecret: string;
}): void {
  if (!params.webhookUrl.startsWith("https://")) {
    throw new Error("Zalo webhook URL must use HTTPS");
  }
  if (params.webhookSecret.length < 8 || params.webhookSecret.length > 256) {
    throw new Error("Zalo webhook secret must be 8-256 characters");
  }
}

/** Runs until `abortSignal` fires. */
export async function startZaloWebhookSession(options: ZaloWebhookSessionOptions): Promise<void> {
  const { webhook, logger } = options;
  assertZaloWebhookMode({ webhookUrl: webhook.webhookUrl, webhookSecret: options.webhookSecret });
  const server = (options.createServerImpl ?? createServer)((req, res) => {
    void dispatch(logger, req, res);
  });
  // Everything that has to be undone lives inside THIS try. The target used to
  // be registered before `listen`, so a bound port (EADDRINUSE) left the
  // account's path registered in the process-wide ported registry forever: the
  // next start refused it and a request that reached another listener answered
  // with a dead account's secret.
  let unregister: (() => void) | undefined;
  let webhookRegistered = false;
  try {
    unregister = zaloWebhookRuntime.registerZaloWebhookTarget({
      account: options.account,
      config: options.cfg,
      runtime: options.runtime ?? {},
      secret: options.webhookSecret,
      path: webhook.path,
      // Upstream's `ingress.accept`: a payload error is a permanent 400, any other
      // throw is a 500 and Zalo redelivers. `ignored` and `durable` both ack.
      acceptWebhook: async (rawEvent: string) => {
        const result = await options.admission.receiveRaw(rawEvent);
        if (result.kind === "invalid") {
          throw new ZaloWebhookPayloadError(result.reason);
        }
      },
    });
    await listen(server, webhook.port, webhook.host);
    const address = server.address();
    if (options.onListening !== undefined && address !== null && typeof address === "object") {
      options.onListening(address.port);
    }
    if (options.skipWebhookRegistration !== true) {
      await setWebhook(
        options.token,
        { url: webhook.webhookUrl, secret_token: options.webhookSecret }, // pragma: allowlist secret
        options.fetcher,
      );
      webhookRegistered = true;
    }
    options.setStatus?.({
      mode: "webhook",
      connected: true,
      webhookPath: webhook.path,
      lastConnectedAt: Date.now(),
    });
    await waitForAbort(options.abortSignal);
  } finally {
    options.setStatus?.({ mode: "webhook", connected: false });
    unregister?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Only delete a webhook this session actually set: a start that failed
    // before `setWebhook` must not clear the registration a live instance owns.
    if (webhookRegistered) {
      await cleanupWebhook(options);
    }
  }
}

async function cleanupWebhook(options: ZaloWebhookSessionOptions): Promise<void> {
  try {
    await deleteWebhook(options.token, options.fetcher, WEBHOOK_CLEANUP_TIMEOUT_MS);
  } catch (error) {
    options.logger?.warn("zalo webhook delete failed", { error: formatErrorMessage(error) });
  }
}

async function dispatch(
  logger: HostChildLogger | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const handled = await zaloWebhookRuntime.handleZaloWebhookRequest(req, res);
    if (!handled && !res.headersSent) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    }
  } catch (error) {
    // A fault before the handler answered is NOT an acknowledgement: 500 keeps
    // Zalo redelivering, the same rule the admission path follows.
    logger?.warn("zalo webhook request failed", { error: formatErrorMessage(error) });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("Internal Server Error");
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
