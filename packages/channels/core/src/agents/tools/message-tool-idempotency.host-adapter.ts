// Fusion-owned host adapter for `src/agents/tools/message-tool-idempotency.ts` (D-CORE-015).
//
// Upstream imports `GatewayCallOptions` from `src/agents/tools/gateway.ts`, which
// pulls the Gateway client, caller identity and session-spawn context. Only the
// option shape is needed here; it is copied from that module.

/** Optional gateway connection overrides accepted by agent tools. */
export type GatewayCallOptions = {
  gatewayUrl?: string;
  gatewayToken?: string;
  timeoutMs?: number;
};
