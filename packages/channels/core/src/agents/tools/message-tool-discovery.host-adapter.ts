// Fusion-owned host adapter for `src/agents/tools/message-tool-discovery.ts` (D-CORE-017).
//
// Upstream discovery reads four host surfaces the port stops at:
//   - the process plugin registry (`src/channels/plugins/index.ts`)
//   - the per-agent message-tool allowlist in OpenClaw config
//     (`src/infra/outbound/outbound-policy.ts`)
//   - OpenClaw session keys (`src/routing/session-key.ts`), which Fusion does
//     not use: the Hub owns routing and passes the channel/account/target
//     directly, so session-key inference is inert here
//   - the `src/utils/message-channel.ts` barrel (see its own adapter)
// The registry accessors are re-exported from the discovery adapter so both
// ported modules share one registry.
import type { OpenClawConfig } from "../../channels/plugins/types.public.host-adapter.js";

export {
  getChannelPlugin,
  getLoadedChannelPlugin,
  listChannelPlugins,
} from "../../channels/plugins/message-action-discovery.host-adapter.js";
export type { OpenClawConfig } from "../../channels/plugins/types.public.host-adapter.js";

const DEFAULT_ACCOUNT_ID = "default";

/**
 * Per-agent message-action allowlist. Fusion expresses authority as Hub grants
 * scoped to one account and conversation, not as an OpenClaw config allowlist,
 * so discovery is never narrowed here. Returning undefined is upstream's
 * "no allowlist configured" answer.
 */
export function resolveAllowedMessageActions(params: {
  cfg: OpenClawConfig;
  agentId?: string | null;
}): string[] | undefined {
  void params;
  return undefined;
}

/** Canonical account id. Upstream additionally consults its account-id cache. */
export function normalizeAccountId(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? DEFAULT_ACCOUNT_ID : trimmed;
}

export type ParsedSessionDeliveryRoute = {
  accountId?: string;
  channel: string;
  peerKind: string;
  peerId: string;
  threadId?: string;
};

/**
 * OpenClaw encodes the delivery route inside its session key. Fusion passes the
 * route explicitly, so there is nothing to parse and callers keep the caller-
 * supplied current-channel context.
 */
export function parseSessionDeliveryRoute(
  sessionKey: string | undefined | null,
): ParsedSessionDeliveryRoute | null {
  void sessionKey;
  return null;
}
