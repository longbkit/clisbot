// upstream: extensions/zalo/src/monitor.webhook.ts@5d8067a4483
// D-ZL-010: two cuts, both at the OpenClaw gateway boundary.
//
//  1. `registerWebhookTargetWithPluginRoute` binds the path on OpenClaw's
//     process-wide gateway HTTP server (`src/plugins/http-registry.ts`), which
//     Fusion does not have (`@getpaseo/channels-core` D-CORE-321). The vertical
//     owns one `node:http` listener per account (`fusion/webhook-session.ts`)
//     and registers into the caller-owned map `registerWebhookTarget` keeps, so
//     the `route` option and its branch are dropped.
//  2. Upstream's `resolveClientIp` reads the already-validated client ip out of
//     the gateway request scope before falling back to headers. Fusion has no
//     such scope, so the header resolver IS the resolver
//     (`resolveRequestClientIp`); it fails closed the same way — with no
//     `trustedProxies` the socket address wins and headers are ignored.
//
// Everything the 200 depends on is upstream: the rate-limit / method guards,
// the constant-time secret compare answering 401 BEFORE the body is read, the
// 415 ordering, the bounded body read, and the ack written only after
// `acceptWebhook` resolves (upstream 0ac69b9fe80, "ACK webhook only after
// spool").
// Zalo plugin module implements monitor.webhook behavior.
import type { IncomingMessage, ServerResponse } from "node:http";
import { safeEqualSecret } from "@getpaseo/channels-core/plugin-sdk/security-runtime";
import { readWebhookBodyOrReject } from "@getpaseo/channels-core/plugin-sdk/webhook-request-guards";
import {
  createFixedWindowRateLimiter,
  createWebhookAnomalyTracker,
  applyBasicWebhookRequestGuards,
  type RegisterWebhookTargetOptions,
  registerWebhookTarget,
  resolveWebhookTargetWithAuthOrRejectSync,
  withResolvedWebhookRequestPipeline,
  WEBHOOK_ANOMALY_COUNTER_DEFAULTS,
  WEBHOOK_RATE_LIMIT_DEFAULTS,
  resolveRequestClientIp,
  type OpenClawConfig,
} from "./runtime-api.js";
import type { ResolvedZaloAccount } from "./accounts.js";
import type { ZaloRuntimeEnv } from "./monitor.types.js";
import { ZaloWebhookPayloadError } from "./webhook-spool.js";

type ZaloWebhookTarget = {
  account: ResolvedZaloAccount;
  config: OpenClawConfig;
  runtime: ZaloRuntimeEnv;
  secret: string;
  path: string;
  acceptWebhook: (rawEvent: string) => Promise<void>;
};

const ZALO_WEBHOOK_ACCEPTED_HEADER = "x-openclaw-delivery-accepted";
const ZALO_WEBHOOK_ACCEPTED_VALUE = "durable";

const webhookTargets = new Map<string, ZaloWebhookTarget[]>();
const webhookRateLimiter = createFixedWindowRateLimiter({
  windowMs: WEBHOOK_RATE_LIMIT_DEFAULTS.windowMs,
  maxRequests: WEBHOOK_RATE_LIMIT_DEFAULTS.maxRequests,
  maxTrackedKeys: WEBHOOK_RATE_LIMIT_DEFAULTS.maxTrackedKeys,
});
const webhookAnomalyTracker = createWebhookAnomalyTracker({
  maxTrackedKeys: WEBHOOK_ANOMALY_COUNTER_DEFAULTS.maxTrackedKeys,
  ttlMs: WEBHOOK_ANOMALY_COUNTER_DEFAULTS.ttlMs,
  logEvery: WEBHOOK_ANOMALY_COUNTER_DEFAULTS.logEvery,
});

function clearZaloWebhookSecurityStateForTest(): void {
  webhookRateLimiter.clear();
  webhookAnomalyTracker.clear();
}

function getZaloWebhookStatusCounterSizeForTest(): number {
  return webhookAnomalyTracker.size();
}

function recordWebhookStatus(
  runtime: ZaloRuntimeEnv | undefined,
  path: string,
  statusCode: number,
): void {
  webhookAnomalyTracker.record({
    key: `${path}:${statusCode}`,
    statusCode,
    log: runtime?.log,
    message: (count) =>
      `[zalo] webhook anomaly path=${path} status=${statusCode} count=${String(count)}`,
  });
}

function registerZaloWebhookTarget(
  target: ZaloWebhookTarget,
  opts?: Pick<
    RegisterWebhookTargetOptions<ZaloWebhookTarget>,
    "onFirstPathTarget" | "onLastPathTargetRemoved"
  >,
): () => void {
  return registerWebhookTarget(webhookTargets, target, opts).unregister;
}

async function handleZaloWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  return await withResolvedWebhookRequestPipeline({
    req,
    res,
    targetsByPath: webhookTargets,
    allowMethods: ["POST"],
    handle: async ({ targets, path }) => {
      const trustedProxies = targets[0]?.config.gateway?.trustedProxies;
      const allowRealIpFallback = targets[0]?.config.gateway?.allowRealIpFallback === true;
      const clientIp =
        resolveRequestClientIp(req, trustedProxies, allowRealIpFallback) ??
        req.socket.remoteAddress ??
        "unknown";
      const rateLimitKey = `${path}:${clientIp}`;
      const nowMs = Date.now();
      if (
        !applyBasicWebhookRequestGuards({
          req,
          res,
          rateLimiter: webhookRateLimiter,
          rateLimitKey,
          nowMs,
        })
      ) {
        recordWebhookStatus(targets[0]?.runtime, path, res.statusCode);
        return true;
      }

      const headerToken = String(req.headers["x-bot-api-secret-token"] ?? "");
      const target = resolveWebhookTargetWithAuthOrRejectSync({
        targets,
        res,
        isMatch: (entry) => safeEqualSecret(entry.secret, headerToken),
      });
      if (!target) {
        recordWebhookStatus(targets[0]?.runtime, path, res.statusCode);
        return true;
      }
      // Preserve the historical 401-before-415 ordering for invalid secrets while still
      // consuming rate-limit budget on unauthenticated guesses.
      if (
        !applyBasicWebhookRequestGuards({
          req,
          res,
          requireJsonContentType: true,
        })
      ) {
        recordWebhookStatus(target.runtime, path, res.statusCode);
        return true;
      }
      const body = await readWebhookBodyOrReject({
        req,
        res,
        maxBytes: 1024 * 1024,
        timeoutMs: 30_000,
        invalidBodyMessage: "Bad Request",
      });
      if (!body.ok) {
        recordWebhookStatus(target.runtime, path, res.statusCode);
        return true;
      }
      try {
        // Ack only after the raw envelope is durably appended. The spool reserves
        // detached drain work before this request's admission root is released.
        await target.acceptWebhook(body.value);
      } catch (error) {
        res.statusCode = error instanceof ZaloWebhookPayloadError ? 400 : 500;
        res.end(res.statusCode === 400 ? "Bad Request" : "Internal Server Error");
        recordWebhookStatus(target.runtime, path, res.statusCode);
        target.runtime.error?.(
          `[${target.account.accountId}] Zalo webhook admission failed: ${String(error)}`,
        );
        return true;
      }

      // The spool persisted the envelope above; mark the ack as durable so
      // proxies can distinguish it from other 200s (same marker as #104407).
      res.setHeader(ZALO_WEBHOOK_ACCEPTED_HEADER, ZALO_WEBHOOK_ACCEPTED_VALUE);
      res.statusCode = 200;
      res.end("ok");
      return true;
    },
  });
}

export const zaloWebhookRuntime = {
  clearZaloWebhookSecurityStateForTest,
  getZaloWebhookStatusCounterSizeForTest,
  handleZaloWebhookRequest,
  registerZaloWebhookTarget,
};
