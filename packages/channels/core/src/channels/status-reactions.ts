// upstream: src/channels/status-reactions.ts@5d8067a4483
// D-CORE-216: upstream also owns the status-reaction controller (debounce,
// stall timers, terminal hold, tool-emoji resolution) which reads OpenClaw's
// tool-display config and agent identity. Fusion's Hub owns turn status, so
// this file carries the emoji contract the ported channel code reads, verbatim.
// Status reactions signal agent progress with channel-native reactions.

/** Optional emoji overrides for each status reaction state. */
export type StatusReactionEmojis = {
  queued?: string;
  thinking?: string;
  tool?: string;
  coding?: string;
  web?: string;
  deploy?: string;
  build?: string;
  concierge?: string;
  done?: string;
  error?: string;
  stallSoft?: string;
  stallHard?: string;
  compacting?: string;
};

/** Default emoji set used by status reaction controllers. */
export const DEFAULT_EMOJIS: Required<StatusReactionEmojis> = {
  queued: "👀",
  thinking: "🧠",
  tool: "🛠️",
  coding: "💻",
  web: "🌐",
  deploy: "🛫",
  build: "🏗️",
  concierge: "💁",
  done: "✅",
  error: "❌",
  stallSoft: "⏳",
  stallHard: "⚠️",
  compacting: "🗜️",
};
