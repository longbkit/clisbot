// Fusion-owned boundary for the `src/config/types.ts` barrel (D-CORE-205).
//
// Upstream's barrel re-exports the whole `config.json` type universe. The
// ported channel code reads it only for the scalar contracts below; the Hub
// config revision is authoritative for everything else.
export type {
  ContextVisibilityMode,
  DmPolicy,
  DmScope,
  GroupPolicy,
  GroupScope,
  MarkdownConfig,
  MarkdownTableMode,
  ReplyMode,
  ReplyToMode,
  SessionScope,
  StreamingMode,
  TextChunkMode,
  TypingMode,
} from "./types.base.js";
export type { OpenClawConfig } from "./types.openclaw.channels.js";
export type {
  TelegramAccountConfig,
  TelegramActionConfig,
  TelegramConfig,
  TelegramDirectConfig,
  TelegramGroupConfig,
  TelegramInlineButtonsScope,
  TelegramNetworkConfig,
  TelegramTopicConfig,
} from "./types.telegram.js";
