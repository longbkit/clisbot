// Fusion-owned boundary for `src/plugin-sdk/core.ts` (D-CORE-332).
//
// Upstream's barrel is the plugin host's core surface: ~150 re-exports over the
// channel plugin registry, the outbound delivery graph, session-key routing,
// the ACP binding store and the whole `OpenClawPluginApi`. Fusion's Hub owns
// routing, delivery and session state, so only the config and channel-contract
// types the ported channel closure reads are carried, from the same source
// modules upstream names.
export type { OpenClawConfig } from "../config/types.openclaw.js";
export type {
  BaseProbeResult,
  ChannelGroupContext,
} from "../channels/plugins/channel-contract.host-adapter.js";

// Slice 16 addition (Zalo vertical port): the two free-standing target-string
// helpers the ported Zalo sender calls, carried verbatim from the same upstream
// module with their one dependency.
import { normalizeLowercaseStringOrEmpty } from "../normalization-core/string-coerce.js";

/** Remove one of the known provider prefixes from a free-form target string. */
export function stripChannelTargetPrefix(raw: string, ...providers: string[]): string {
  const trimmed = raw.trim();
  for (const provider of providers) {
    const prefix = `${normalizeLowercaseStringOrEmpty(provider)}:`;
    if (normalizeLowercaseStringOrEmpty(trimmed).startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return trimmed;
}

/** Remove generic target-kind prefixes such as `user:` or `group:`. */
export function stripTargetKindPrefix(raw: string): string {
  return raw.replace(/^(user|channel|group|conversation|room|dm):/i, "").trim();
}
