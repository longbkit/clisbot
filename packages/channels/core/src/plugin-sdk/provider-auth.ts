// Fusion-owned boundary for `src/plugin-sdk/provider-auth.ts` (D-CORE-333).
//
// Upstream's barrel is the provider auth-profile surface: OAuth login flows,
// keychain-backed profile stores, API-key resolution and the CLI onboarding
// helpers. Fusion's Hub owns credentials, so only the secret-reference coercion
// the ported channel account readers call is carried, from the same source
// module upstream re-exports (`src/config/types.secrets.ts`, via the core host
// adapter).
export { coerceSecretRef } from "../config/types.secrets.host-adapter.js";
export type { SecretDefaults, SecretRef } from "../config/types.secrets.host-adapter.js";
