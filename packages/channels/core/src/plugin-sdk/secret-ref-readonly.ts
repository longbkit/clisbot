// Fusion-owned boundary for `src/plugin-sdk/secret-ref-readonly.ts` (D-CORE-334).
//
// Upstream also exports `resolveReadOnlyEnvSecretRef`, which reads a credential
// out of `process.env` once the provider allowlist admits it. Fusion's Hub owns
// credential resolution, so only the predicate the ported channel account
// readers call is carried; see `config/types.secrets.host-adapter.ts` for why it
// answers `false`.
export { canResolveEnvSecretRefInReadOnlyPath } from "../config/types.secrets.host-adapter.js";
