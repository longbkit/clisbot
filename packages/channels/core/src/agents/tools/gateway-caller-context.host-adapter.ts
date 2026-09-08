// Fusion-owned host adapter for `src/agents/tools/gateway-caller-context.ts` (D-CORE-025).
//
// Upstream reads the identity of the Gateway client that invoked the tool from
// an async-local store. Fusion's caller is the Hub itself (the channel-reply MCP
// capability already carries the authority), so there is no separate gateway
// caller identity to record.
import type { ExecutionIdentityAdmissionToken } from "../../audit/execution-identity-admission.host-adapter.js";

export type GatewayToolCallerIdentity = {
  clientName?: string;
  clientDisplayName?: string;
  mode?: string;
  /** Admitted execution provenance the audit record carries through. */
  executionIdentityToken?: ExecutionIdentityAdmissionToken;
};

export function getGatewayToolCallerIdentity(): GatewayToolCallerIdentity | undefined {
  return undefined;
}
