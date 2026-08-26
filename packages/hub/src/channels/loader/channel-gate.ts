// The channel control-plane kill-switch (plan §14.8 / implementation doc §4.5,
// env-alias table). `PASEO_HUB_CHANNELS_ENABLED` (operator name
// `CLISBOT_HUB_CHANNELS_ENABLED`) defaults to "1"; the supervisor turns the whole
// channel plane off with an explicit "0". The loader's entry point reads it and
// short-circuits BEFORE touching any channel code — no vertical load, no account
// start, no daemon channel-client connection — so a flag-off Hub loads no channel
// supply at all (the byte-equivalent / flag-off claim). The follow-up index.ts
// wiring reads `isChannelsEnabled` to skip the channel mount entirely; this module
// is the shared predicate both that wiring and `loadChannelVertical` use.

type EnvLike = Record<string, string | undefined>;

const CHANNELS_ENABLED_KEY = "PASEO_HUB_CHANNELS_ENABLED";

function isDisabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "0" || trimmed === "false" || trimmed === "no" || trimmed === "off";
}

/** True when the channel control plane is enabled (the default). The internal
 * `PASEO_HUB_CHANNELS_ENABLED` name is authoritative — the `CLISBOT_*` alias is
 * resolved to it at process entry by `env-alias.ts`, so this reads the internal
 * name the fork code uses everywhere. */
export function isChannelsEnabled(environment: EnvLike = process.env): boolean {
  return !isDisabled(environment[CHANNELS_ENABLED_KEY]);
}

/** Refuse to load a channel vertical when the kill-switch is off. Throws a typed
 * error so a direct `loadChannelVertical` call cannot bypass the gate. The index.ts
 * wiring is expected to consult `isChannelsEnabled` first and never reach the
 * loader when the plane is off. */
export function assertChannelsEnabled(environment: EnvLike = process.env): void {
  if (isChannelsEnabled(environment)) return;
  throw new ChannelsDisabledError(
    `channel control plane is disabled (${CHANNELS_ENABLED_KEY}); no channel verticals load`,
  );
}

export class ChannelsDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelsDisabledError";
  }
}
