// Fusion-owned boundary for `src/plugin-sdk/channel-config-helpers.ts` (D-CORE-250).
//
// Upstream's barrel owns channel config CRUD adapters, config-write
// authorization and DM access policy — all wired to OpenClaw's `config.json`
// writer. Fusion's Hub owns channel configuration and never lets a vertical
// write it, so only the two pure readers the ported Slack account resolver
// calls are carried; both keep upstream's bodies (`channel-config-helpers.ts`
// and `channels/plugins/dm-access.ts`).
import { normalizeStringEntries } from "../normalization-core/string-normalization.js";

/**
 * Supported direct-message policy values for channel account config.
 */
export type ChannelDmPolicy = "pairing" | "allowlist" | "open" | "disabled";

/** Coerce mixed allowlist config values into plain strings without trimming or deduping. */
export function mapAllowFromEntries(
  allowFrom: Array<string | number> | null | undefined,
): string[] {
  return (allowFrom ?? []).map((entry) => String(entry));
}

/** Normalize user-facing allowlist entries the same way config and doctor flows expect. */
export function formatTrimmedAllowFromEntries(allowFrom: Array<string | number>): string[] {
  return normalizeStringEntries(allowFrom);
}

/**
 * Narrows a raw string to a supported channel DM policy.
 */
export function normalizeChannelDmPolicy(value: string | undefined): ChannelDmPolicy | undefined {
  return value === "pairing" || value === "allowlist" || value === "open" || value === "disabled"
    ? value
    : undefined;
}
