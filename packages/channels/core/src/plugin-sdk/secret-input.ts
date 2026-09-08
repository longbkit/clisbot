// Fusion-owned boundary for `src/plugin-sdk/secret-input.ts` (D-CORE-257).
//
// Upstream's barrel also exports the zod secret-input schema builders, the
// sensitive-schema registry and the built-in provider-ref predicates, all wired
// to OpenClaw's secret runtime. Fusion's Hub owns credentials; only the readers
// the ported Slack account/token code calls are carried, from the host adapter
// for the same source module.
export type { SecretDefaults, SecretInput, SecretRef } from "../config/types.secrets.host-adapter.js";
export {
  hasConfiguredSecretInput,
  isSecretRef,
  normalizeResolvedSecretInputString,
  normalizeSecretInputString,
} from "../config/types.secrets.host-adapter.js";

// Slice 13 addition (Discord vertical port): the ported Discord token resolver
// reads the literal-or-reference value through upstream's
// `resolveSecretInputString` name.
export { resolveSecretInputString } from "../config/types.secrets.host-adapter.js";

// Slice 14 addition (Google Chat vertical port): the resolution mode the ported
// Google Chat account reader threads from `resolveAccount` / `inspectAccount`.
export type { SecretInputStringResolutionMode } from "../config/types.secrets.host-adapter.js";


// Slice 15 additions (Feishu vertical port): the ported Feishu config schema
// declares its credential fields with upstream's shared secret-input schema, so
// the schema builder and the sensitive-registry helper come from the same
// source module upstream's barrel names (`src/plugin-sdk/secret-input-schema.ts`).
export {
  buildSecretInputSchema,
  registerSensitiveConfigSchema,
} from "./secret-input-schema.js";
