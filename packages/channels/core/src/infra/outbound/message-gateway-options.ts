// upstream: src/infra/outbound/message-gateway-options.ts@5d8067a4483
// Gateway option normalization hides transport URL details for backend/managed
// gateway clients and clamps timeout values.
import { resolveTimerTimeoutMs } from "../../normalization-core/number-coercion.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName,
} from "../../utils/message-channel.host-adapter.js";

/** Raw gateway options accepted by outbound message senders. */
export type OutboundMessageGatewayOptionsInput = {
  url?: string;
  token?: string;
  timeoutMs?: number;
  clientName?: GatewayClientName;
  clientDisplayName?: string;
  mode?: GatewayClientMode;
  resolveAgentRuntimeIdentityToken?: () => Promise<string | undefined>;
};

/** Normalizes outbound gateway options and fills CLI defaults. */
export function resolveOutboundMessageGatewayOptions(gateway?: OutboundMessageGatewayOptionsInput) {
  const clientName = gateway?.clientName ?? GATEWAY_CLIENT_NAMES.CLI;
  const mode = gateway?.mode ?? GATEWAY_CLIENT_MODES.CLI;
  // Backend-mode callers and gateway clients use the managed transport endpoint.
  const url =
    mode === GATEWAY_CLIENT_MODES.BACKEND || clientName === GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT
      ? undefined
      : gateway?.url;
  return {
    url,
    token: gateway?.token,
    timeoutMs: resolveTimerTimeoutMs(gateway?.timeoutMs, 10_000),
    clientName,
    clientDisplayName: gateway?.clientDisplayName,
    mode,
  };
}
