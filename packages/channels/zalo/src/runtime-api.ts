// upstream: extensions/zalo/runtime-api.ts@5d8067a4483
// D-ZL-001: upstream's `runtime-api.ts` is the plugin's OpenClaw host binding —
// it re-exports ~60 members of `openclaw/plugin-sdk/*` (the pairing controller,
// the reply pipeline, the setup/wizard helpers, the config contracts, the
// gateway webhook registry) plus the plugin runtime setter, so the bundled
// plugin can be loaded by an OpenClaw host without importing `openclaw` itself.
// Fusion has no OpenClaw host: the members this vertical's ported closure reads
// come from `@getpaseo/channels-core`, which mirrors the same upstream source
// modules. The file is kept, at the same name and with the same job, so the
// ported `monitor.webhook.ts` keeps upstream's import block; everything it
// re-exports that the Hub owns (setup, pairing, reply delivery, plugin HTTP
// routes) is dropped rather than re-implemented.
export type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
export {
  applyBasicWebhookRequestGuards,
  createFixedWindowRateLimiter,
  createWebhookAnomalyTracker,
  registerWebhookTarget,
  resolveWebhookPath,
  resolveWebhookTargetWithAuthOrRejectSync,
  resolveRequestClientIp,
  WEBHOOK_ANOMALY_COUNTER_DEFAULTS,
  WEBHOOK_RATE_LIMIT_DEFAULTS,
  withResolvedWebhookRequestPipeline,
} from "@getpaseo/channels-core/plugin-sdk/webhook-ingress";
export type { RegisterWebhookTargetOptions } from "@getpaseo/channels-core/plugin-sdk/webhook-ingress";
export { setZaloRuntime } from "./runtime.js";
