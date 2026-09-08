// upstream: src/plugin-sdk/plugin-config-runtime.ts@5d8067a4483
// Plugin config runtime helpers load and normalize plugin-owned configuration at execution time.
import type { OpenClawConfig } from "../config/types.js";

/** Requires an already-resolved runtime config at plugin runtime boundaries. */
export function requireRuntimeConfig(config: OpenClawConfig, context: string): OpenClawConfig {
  if (config) {
    return config;
  }
  throw new Error(
    `${context} requires a resolved runtime config. Load and resolve config at the command or gateway boundary, then pass cfg through the runtime path.`,
  );
}
// D-CORE-219: the upstream module also normalizes and writes the
// `plugins.entries[id].config` block (`src/plugins/config-state.ts`) and
// re-exports OpenClaw's deep-merge. Fusion's Hub owns channel configuration, so
// plugins never read or write config state here.
