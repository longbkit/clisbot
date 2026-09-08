// Fusion-owned boundary for `openclaw/plugin-sdk/plugin-config-runtime`
// (D-034).
//
// Upstream loads `config.json` once at the command/gateway boundary and threads
// the resolved `OpenClawConfig` down every call, so `requireRuntimeConfig` only
// has to assert it is present. Fusion's Hub owns configuration and passes it in
// on the drive surface (`plugin.outbound.sendText({ cfg, ... })`,
// `gateway.startAccount({ cfg })`) — but the shared `message` tool's action
// runner does not: `packages/hub/src/channels/message-actions.ts` calls core's
// runner with an empty `cfg`, because core's own action contract carries the
// account through `accountId` and leaves credentials to the vertical.
//
// So the vertical remembers the last drive-time config it was handed and
// `requireRuntimeConfig` falls back to it when the caller passes an empty one.
// That is what makes a Hub-dispatched `handleAction` (react / edit / delete /
// pin / read / upload) able to resolve
// `cfg.channels.slack.accounts.<id>.botToken` at all. The remembered config is
// per process and is replaced on every drive, so it always reflects the Hub's
// current revision.

import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";

let driveConfig: OpenClawConfig | undefined;

function hasSlackSection(config: unknown): config is OpenClawConfig {
  if (config === null || typeof config !== "object") return false;
  const channels = (config as { channels?: unknown }).channels;
  return channels !== null && typeof channels === "object" && "slack" in channels;
}

/**
 * Records the config the Hub handed the drive surface. Called from
 * `startAccount` and from every outbound send.
 */
export function rememberSlackDriveConfig(config: unknown): void {
  if (hasSlackSection(config)) {
    driveConfig = config;
  }
}

/** Test seam: drop the remembered drive config. */
export function clearSlackDriveConfigForTest(): void {
  driveConfig = undefined;
}

/** The remembered drive config, if the vertical has been driven. */
export function getSlackDriveConfig(): OpenClawConfig | undefined {
  return driveConfig;
}

/** Requires an already-resolved runtime config at plugin runtime boundaries. */
export function requireRuntimeConfig(config: OpenClawConfig, context: string): OpenClawConfig {
  if (hasSlackSection(config)) {
    return config;
  }
  if (driveConfig) {
    return driveConfig;
  }
  if (config) {
    return config;
  }
  throw new Error(
    `${context} requires a resolved runtime config. Load and resolve config at the command or gateway boundary, then pass cfg through the runtime path.`,
  );
}
