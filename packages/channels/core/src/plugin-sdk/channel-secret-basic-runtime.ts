// upstream: src/plugin-sdk/channel-secret-basic-runtime.ts@5d8067a4483
// Narrow shared secret-contract exports for non-TTS channel/plugin secret surfaces.
//
// D-CORE-323: the upstream barrel re-exports OpenClaw's whole channel
// secret-contract surface (`src/secrets/channel-secret-basic-runtime.ts`,
// `src/secrets/runtime-shared.ts`, the secret target registry). Fusion's Hub
// owns credentials, so a ported vertical never writes a secret contract; only
// the record guard the ported webhook/event parsers read is carried, from the
// same source module upstream re-exports it from (`src/secrets/shared.ts` →
// `src/utils.ts` → `normalization-core/record-coerce.ts`).
export { isRecord } from "../normalization-core/record-coerce.js";
