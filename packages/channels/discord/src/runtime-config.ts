// upstream: extensions/discord/src/runtime-config.ts@5d8067a4483
// D-DC-007: upstream reconciles the caller's config against OpenClaw's global
// runtime config snapshot (`openclaw/plugin-sdk/runtime-config-snapshot`), which
// reads the process-wide `config.json` cache. Fusion's Hub owns channel
// configuration and hands every drive-time entry point the already-resolved
// `cfg`, so there is no second snapshot to select from: the input config IS the
// runtime config. `selectDiscordRuntimeConfig` keeps its signature and its
// callers, and returns the config it was given.
//
// `selectDiscordActivitiesRuntimeConfig` is omitted with the Activities surface
// (`src/activities/**`, see upstream-sync.json `omitted`): its only job is to
// restore plugin-owned `activities.clientSecret` from the source snapshot.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";

export function selectDiscordRuntimeConfig(inputConfig: OpenClawConfig): OpenClawConfig {
  return inputConfig;
}
