// upstream: extensions/googlechat/src/monitor-types.ts@5d8067a4483
import type { ChannelAccountSnapshot } from "@getpaseo/channels-core/plugin-sdk/channel-contract";
// Googlechat plugin module implements monitor types behavior.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import type { ResolvedGoogleChatAccount } from "./accounts.js";
import type { GoogleChatAudienceType } from "./auth.js";
import type { GoogleChatWebhookAdmission } from "./fusion/admission.js";
import type { getGoogleChatRuntime } from "./runtime.js";

export type GoogleChatRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type GoogleChatStatusSink = (patch: Partial<ChannelAccountSnapshot>) => void;

export type GoogleChatMonitorOptions = {
  account: ResolvedGoogleChatAccount;
  config: OpenClawConfig;
  runtime: GoogleChatRuntimeEnv;
  abortSignal: AbortSignal;
  webhookPath?: string;
  webhookUrl?: string;
  statusSink?: GoogleChatStatusSink;
};

export type GoogleChatCoreRuntime = ReturnType<typeof getGoogleChatRuntime>;

export type WebhookTarget = {
  account: ResolvedGoogleChatAccount;
  config: OpenClawConfig;
  runtime: GoogleChatRuntimeEnv;
  core: GoogleChatCoreRuntime;
  path: string;
  audienceType?: GoogleChatAudienceType;
  audience?: string;
  statusSink?: GoogleChatStatusSink;
  mediaMaxMb: number;
  // D-GC-012: upstream types this as the account's
  // `createStandardRawEventIngressMonitor` handle (`monitor-ingress.ts`), which
  // opens OpenClaw's SQLite-backed `openChannelIngressQueue` and runs its own
  // drain. Fusion's Hub owns the durable queue and the drain
  // (`channel_ingress_queue`, `hub/src/channels/ingress/drain.ts`), so the seam
  // is the Fusion admission with the same `receive` contract: `durable` once the
  // event is persisted, `ignored` for a non-turn event, `invalid` for a payload
  // the normalizer rejects, and a THROW when admission failed.
  ingress: Pick<GoogleChatWebhookAdmission, "receive">;
};
