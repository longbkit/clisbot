// upstream: src/config/types.base.ts@5d8067a4483
// D-CORE-003: trimmed to the scalar/streaming/markdown config contracts the
// ported channel formatters and streaming-compat readers import. The rest of
// the upstream file describes OpenClaw's `config.json` shape (sessions, human
// delay, per-channel account blocks), which Fusion does not own — the Hub
// config revision is authoritative here. See upstream-sync.json.

/** Reply handling mode for chat command surfaces. */
export type ReplyMode = "text" | "command";
/** Typing indicator timing policy shared by channel configs. */
export type TypingMode = "never" | "instant" | "thinking" | "message";
/** Session-key ownership model for inbound messages. */
export type SessionScope = "per-sender" | "global";
/** DM session-key granularity across peers, channels, and accounts. */
export type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
export type GroupScope = "main" | "per-group";
/** Which source messages outbound replies should thread or quote against. */
export type ReplyToMode = "off" | "first" | "all" | "batched";
/** Group-chat admission policy for channels with allowlists. */
export type GroupPolicy = "open" | "disabled" | "allowlist";
/** Direct-message admission policy for channels with pairing/allowlists. */
export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";
/** How much non-allowlisted context is visible to an agent. */
export type ContextVisibilityMode = "all" | "allowlist" | "allowlist_quote";
/** Text splitting strategy for outbound channel delivery. */
export type TextChunkMode = "length" | "newline";
/** Preview/progress delivery mode while an agent response is still streaming. */
export type StreamingMode = "off" | "partial" | "block" | "progress";
/** How command text is represented in streaming progress previews. */
export type ChannelStreamingCommandTextMode = "raw" | "status";

export type OutboundRetryConfig = {
  /** Max retry attempts for outbound requests (default: 3). */
  attempts?: number;
  /** Minimum retry delay in ms (default: 300-500ms depending on provider). */
  minDelayMs?: number;
  /** Maximum retry delay cap in ms (default: 30000). */
  maxDelayMs?: number;
  /** Jitter factor (0-1) applied to delays (default: 0.1). */
  jitter?: number;
};

export type BlockStreamingCoalesceConfig = {
  /** Minimum buffered characters before coalesced block delivery. */
  minChars?: number;
  /** Maximum buffered characters before a block must be flushed. */
  maxChars?: number;
  /** Idle time in ms before flushing a partial coalesced block. */
  idleMs?: number;
};

export type BlockStreamingChunkConfig = {
  /** Minimum preview chunk size before sending another draft update. */
  minChars?: number;
  /** Maximum preview chunk size before forcing a draft update. */
  maxChars?: number;
  /** Preferred natural boundary when splitting preview chunks. */
  breakPreference?: "paragraph" | "newline" | "sentence";
};

export type ChannelStreamingProgressConfig = {
  /** Initial progress title. "auto" picks from labels; false hides the title. Default: "auto". */
  label?: string | false;
  /** Candidate labels for label="auto". Defaults to OpenClaw's built-in progress labels. */
  labels?: string[];
  /** Maximum number of progress lines to keep below the label. Default: 8. */
  maxLines?: number;
  /** Maximum characters per compact progress line before truncation. Default: 120. */
  maxLineChars?: number;
  /** Include compact tool/task progress in the draft. Default: true. */
  toolProgress?: boolean;
  /** Command/exec progress detail in the draft. "raw" opts into command text; "status" shows only the tool label. Default: "status". */
  commandText?: ChannelStreamingCommandTextMode;
  /** Include assistant commentary/preamble text in the progress draft. Default: false. */
  commentary?: boolean;
  /**
   * Replace tool lines with a short utility-model narration of what the agent
   * is doing. Runs when a utility model resolves (explicit `utilityModel` or
   * the primary provider's declared default). Default: true.
   */
  narration?: boolean;
};

export type ChannelStreamingPreviewConfig = {
  /** Chunking thresholds for preview-draft updates while streaming. */
  chunk?: BlockStreamingChunkConfig;
  /**
   * Render live tool/activity updates into the preview draft for channels that
   * edit a single preview message in place.
   * Default: true.
   */
  toolProgress?: boolean;
  /** Command/exec progress detail in the preview. "raw" opts into command text; "status" shows only the tool label. Default: "status". */
  commandText?: ChannelStreamingCommandTextMode;
};

export type ChannelStreamingBlockConfig = {
  /** Enable chunked block-reply delivery for channels that support it. */
  enabled?: boolean;
  /** Merge streamed block replies before sending. */
  coalesce?: BlockStreamingCoalesceConfig;
};

export type ChannelStreamingConfig<
  TProgress extends ChannelStreamingProgressConfig = ChannelStreamingProgressConfig,
> = {
  /**
   * Preview streaming mode:
   * - "off": disable preview updates
   * - "partial": update one preview in place
   * - "block": emit larger chunked preview updates
   * - "progress": progress/status preview mode for channels that support it
   */
  mode?: StreamingMode;
  /** Chunking mode for outbound text delivery. */
  chunkMode?: TextChunkMode;
  /** Prefer a channel's native streaming transport over its portable draft path. */
  nativeTransport?: boolean;
  preview?: ChannelStreamingPreviewConfig;
  progress?: TProgress;
  block?: ChannelStreamingBlockConfig;
};

export type ChannelDeliveryStreamingConfig = Pick<ChannelStreamingConfig, "chunkMode" | "block">;

export type MarkdownTableMode = "off" | "bullets" | "code" | "block";

export type MarkdownConfig = {
  /** Table rendering mode (off|bullets|code|block). */
  tables?: MarkdownTableMode;
};
