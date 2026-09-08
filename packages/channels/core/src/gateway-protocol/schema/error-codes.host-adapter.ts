// Fusion-owned host adapter for `packages/gateway-protocol/src/schema/error-codes.ts` (D-CORE-058).
//
// Upstream's schema module re-exports the error-code tables and also builds the
// TypeBox frame schemas for the Gateway WebSocket protocol. Fusion does not speak
// that protocol; the ported action layer reads only the code tables, which come
// from the carried `gateway-error-details.ts` source module.
export { ErrorCodes, GatewayErrorDetailCodes } from "../gateway-error-details.js";
export type { ErrorCode, GatewayErrorDetails } from "../gateway-error-details.js";
