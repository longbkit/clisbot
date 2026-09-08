// Fusion-owned boundary for `src/config/types.openclaw.ts` (D-CORE-205).
//
// Upstream's `OpenClawConfig` is the root of the whole `config.json` type graph
// (agents, gateway, sessions, every channel). Fusion's Hub owns configuration,
// so the ported code sees the opaque host shape declared next to the channel
// plugin contract, with the Telegram section typed for the ported vertical.
export type { OpenClawConfig } from "./types.openclaw.channels.js";
export type { TelegramConfig } from "./types.telegram.js";
