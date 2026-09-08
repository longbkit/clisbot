// upstream: src/plugin-sdk/ssrf-runtime.ts@5d8067a4483
// Narrow SSRF helpers for extensions that need pinned-dispatcher and policy
// utilities without loading the full infra-runtime surface.

export { formatErrorMessage } from "../infra/errors.js";
// D-CORE-004: the upstream barrel also re-exports the pinned-dispatcher /
// fetch-guard / private-network-policy surface from `src/infra/net/*` and
// `src/gateway/net.ts`. Fusion channel transports own their own fetch stack
// (`packages/channels/telegram/src/leaves/telegram-policy.ts`), so slice 5
// carries only the error formatter the ported files import from this subpath.
