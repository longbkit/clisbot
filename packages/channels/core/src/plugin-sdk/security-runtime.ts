// Fusion-owned boundary for `src/plugin-sdk/security-runtime.ts` (D-CORE-244).
//
// Upstream's barrel is the whole plugin trust-boundary surface: symlink-safe
// file access, channel metadata builders, supplemental-context visibility,
// access groups and external-content wrapping. The ported Slack send path reads
// only the timing-safe secret comparison used to authenticate an interactive
// callback signature.
export { safeEqualSecret } from "../security/secret-equal.js";

// Slice 15 addition (Feishu vertical port): the ported Feishu tool-result
// wrapper marks network-sourced content as untrusted before it reaches the
// model. Same upstream barrel, same source module
// (`src/security/external-content.ts`, carried whole).
export {
  truncateSanitizedExternalContent,
  wrapExternalContent,
  wrapWebContent,
} from "../security/external-content.js";
