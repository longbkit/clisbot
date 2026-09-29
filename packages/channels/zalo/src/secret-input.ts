// upstream: extensions/zalo/src/secret-input.ts@5d8067a4483
// D-ZL-004: upstream also re-exports `buildSecretInputSchema`, the zod builder
// its `config-schema.ts` composes. The Hub owns the channel config schema, so
// `config-schema.ts` is omitted and the builder is not carried in
// `@clisbot/channels-core`; the two readers the ported token/account code calls
// are unchanged.
// Zalo plugin module implements secret input behavior.
export {
  normalizeSecretInputString,
  resolveSecretInputString,
} from "@clisbot/channels-core/plugin-sdk/secret-input";
export type { SecretInputStringResolutionMode } from "@clisbot/channels-core/plugin-sdk/secret-input";
