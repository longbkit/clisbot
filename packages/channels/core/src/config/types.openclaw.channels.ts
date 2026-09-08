// Fusion-owned boundary for the channel-typed view of `OpenClawConfig`
// (D-CORE-239).
//
// Upstream's `OpenClawConfig` types every channel section from the real
// `config.json` graph, so ported channel code can read
// `cfg.channels.slack.accounts` with full types. Fusion's Hub owns
// configuration and the host adapter keeps channel sections opaque
// (D-CORE-010), which is right for the host but leaves the ported verticals
// without their own section. This file re-declares the host shape with the
// ported channel sections typed; every other section stays opaque.
import type { OpenClawConfig as HostOpenClawConfig } from "../channels/plugins/types.public.host-adapter.js";
import type { GroupPolicy } from "./types.base.js";
import type { SecretDefaults } from "./types.secrets.host-adapter.js";
import type { DiscordConfig } from "./types.discord.js";
import type { GoogleChatConfig } from "./types.googlechat.js";
import type { SlackConfig } from "./types.slack.js";
import type { TelegramConfig } from "./types.telegram.js";

/** Upstream: JSON-compatible open-world channel section for plugin ids unknown to core. */
type OpenWorldChannelConfig = ReturnType<typeof JSON.parse>;

/** Host-owned channel defaults the ported group-policy resolvers read. */
export type ChannelDefaultsConfig = {
  groupPolicy?: GroupPolicy;
  [key: string]: unknown;
};

/**
 * One configured routing binding. Upstream's shape is the full binding record
 * (match, agent, session policy); only the match fields the ported Slack
 * enterprise guard walks are typed.
 */
export type ConfiguredBinding = {
  type?: string;
  match: {
    channel: string;
    accountId?: string;
    teamId?: string;
    peer?: { id: string; kind?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/** Host config with the ported channel sections typed. */
export type OpenClawConfig = Omit<HostOpenClawConfig, "channels" | "agents" | "session"> & {
  channels?: {
    discord?: DiscordConfig;
    googlechat?: GoogleChatConfig;
    slack?: SlackConfig;
    telegram?: TelegramConfig;
    defaults?: ChannelDefaultsConfig;
    /**
     * Upstream `src/config/types.channels.ts`: channel sections are
     * plugin-owned and keyed by arbitrary channel ids, so the index signature
     * is open-world (`ReturnType<typeof JSON.parse>`). A vertical whose section
     * is not typed above — Feishu, whose config type is inferred from its own
     * zod schema inside the vertical — reads it through this signature exactly
     * as it does upstream. Sections typed above keep their types.
     */
    [key: string]: OpenWorldChannelConfig;
  };
  /** Only the media/image ceilings the ported outbound and action paths read. */
  agents?: {
    defaults?: {
      mediaMaxMb?: number;
      imageMaxDimensionPx?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /**
   * Only the proxy-trust fields the ported webhook handlers read when they key
   * a rate-limit bucket on the client ip. Upstream's block is the whole OpenClaw
   * gateway server config.
   */
  gateway?: {
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    [key: string]: unknown;
  };
  /** Configured routing bindings; read by the ported Slack enterprise guard. */
  bindings?: ConfiguredBinding[];
  /** Only the store handle the ported TTS lookup passes through is typed. */
  session?: { store?: unknown };
  /** Secret-provider defaults the ported token resolvers pass through. */
  secrets?: { defaults?: SecretDefaults; [key: string]: unknown };
};
