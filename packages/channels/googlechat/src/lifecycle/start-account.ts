// L4 account lifecycle (blueprint §6.5 L4, start-account.md): resolve the
// account and its service-account credential, install the account's ported
// plugin runtime, register the L3 inbound processor, then hand off to the L2
// webhook session. The startAccount promise resolves only when
// `ctx.abortSignal` fires — "start" is the transport lifetime.
//
// Upstream's equivalent is `gateway.ts` + `monitor.ts`'s
// `monitorGoogleChatProvider`: it binds a route on the OpenClaw gateway server,
// opens a SQLite ingress queue and runs OpenClaw's passive account lifecycle.
// The Hub owns routing, the queue and the lifecycle, so the L4 here does only
// what the seam contract asks (D-GC-015).

import type { HostRuntime, StartAccountContext } from "@getpaseo/channels-shared";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { normalizeOptionalLowercaseString } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";
import { probeGoogleChat } from "../api.js";
import type { GoogleChatAudienceType } from "../auth.js";
import { createGoogleChatAdmission } from "../fusion/admission.js";
import { resolveGoogleChatDriveAccount } from "../fusion/account-config.js";
import { installGoogleChatRuntime } from "../fusion/runtime.js";
import {
  resolveGoogleChatWebhookMode,
  startGoogleChatWebhookSession,
} from "../fusion/webhook-session.js";
import type { WebhookTarget } from "../monitor-types.js";
import { warnAppPrincipalMisconfiguration } from "../monitor-webhook.js";
import { getGoogleChatRuntime } from "../runtime.js";
import { registerAccountInbound, unregisterAccountInbound } from "../runtime-store.js";

/** Upstream `monitor.ts`, unchanged: the audience-type spellings it accepts. */
export function normalizeAudienceType(value?: string | null): GoogleChatAudienceType | undefined {
  const normalized = normalizeOptionalLowercaseString(value);
  if (normalized === "app-url" || normalized === "app_url" || normalized === "app") {
    return "app-url";
  }
  if (
    normalized === "project-number" ||
    normalized === "project_number" ||
    normalized === "project"
  ) {
    return "project-number";
  }
  return undefined;
}

/** `plugin.gateway.startAccount` — the drive surface entry. Resolves on abort. */
export async function startGoogleChatAccount(
  ctx: StartAccountContext,
  hostRuntime: HostRuntime,
): Promise<void> {
  const log = ctx.log;
  const { accountId, abortSignal } = ctx;
  if (ctx.cfg === undefined || ctx.cfg === null) {
    throw new Error("googlechat startAccount requires a runtime config (ctx.cfg)");
  }
  const account = resolveGoogleChatDriveAccount(ctx);
  if (account.credentialSource === "none" || account.tokenStatus === "configured_unavailable") {
    throw new Error(
      `googlechat account "${accountId}" has no usable service-account credential (source=${account.credentialSource}, status=${account.tokenStatus ?? "unknown"})`,
    );
  }
  // Google signs every inbound request for the configured audience, so an
  // account without one cannot authenticate ANY delivery. Upstream reports this
  // as a blocked account rather than starting a route that refuses everything.
  const audienceType = normalizeAudienceType(account.config.audienceType);
  const audience = account.config.audience?.trim();
  if (audienceType === undefined || audience === undefined || audience === "") {
    throw new Error(
      `googlechat account "${accountId}" needs channels.googlechat.audienceType (app-url|project-number) and channels.googlechat.audience; without them no inbound request can be verified`,
    );
  }
  const webhook = resolveGoogleChatWebhookMode(account.config);
  if (webhook === null) {
    throw new Error(
      `googlechat account "${accountId}" has an unparseable webhookUrl; no inbound webhook route was registered`,
    );
  }
  warnAppPrincipalMisconfiguration({
    accountId,
    audienceType,
    ...(account.config.appPrincipal === undefined
      ? {}
      : { appPrincipal: account.config.appPrincipal }),
    ...(log?.warn === undefined ? {} : { log: (message: string) => log.warn(message) }),
  });

  installGoogleChatRuntime(hostRuntime, accountId);
  // The identity probe is a real Chat API call, so a bad credential fails the
  // account start instead of failing every later delivery silently.
  const probe = await probeGoogleChat(account);
  if (!probe.ok) {
    unregisterAccountInbound(accountId, hostRuntime);
    throw new Error(`googlechat: service-account probe failed: ${probe.error ?? "unknown error"}`);
  }
  const inbound = registerAccountInbound(accountId, account.config.botUser, hostRuntime);
  const admission = createGoogleChatAdmission({
    accountId,
    ...(account.config.botUser === undefined ? {} : { botUser: account.config.botUser }),
    ...(account.config.allowBots === undefined ? {} : { allowBots: account.config.allowBots }),
    handleInbound: (event) => inbound.handleInbound(event),
  });
  const target: WebhookTarget = {
    account,
    config: ctx.cfg as unknown as OpenClawConfig,
    runtime: {
      ...(log?.info === undefined ? {} : { log: (message: string) => log.info?.(message) }),
      ...(log?.error === undefined ? {} : { error: (message: string) => log.error?.(message) }),
    },
    core: getGoogleChatRuntime(accountId),
    path: webhook.path,
    audienceType,
    audience,
    mediaMaxMb: account.config.mediaMaxMb ?? 20,
    ingress: admission,
  };
  log?.info?.("googlechat account started", { accountId, webhookPath: webhook.path });
  ctx.setStatus({ state: "connected", accountId, webhookPath: webhook.path, audienceType });
  try {
    await startGoogleChatWebhookSession({
      target,
      webhook,
      abortSignal,
      ...(log === undefined ? {} : { logger: log }),
      setStatus: (patch) => ctx.setStatus({ accountId, ...patch }),
    });
  } finally {
    unregisterAccountInbound(accountId, hostRuntime);
    ctx.setStatus({ state: "stopped", accountId });
  }
}
