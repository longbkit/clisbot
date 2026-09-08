// upstream: src/plugin-sdk/channel-targets.ts@5d8067a4483
/**
 * Public SDK subpath for channel target parsing, matching, and allowlist helpers.
 */
export {
  applyChannelMatchMeta,
  buildChannelKeyCandidates,
  normalizeChannelSlug,
  resolveChannelEntryMatch,
  resolveChannelEntryMatchWithFallback,
  resolveChannelMatchConfig,
  resolveNestedAllowlistDecision,
  type ChannelEntryMatch,
  type ChannelMatchSource,
} from "../channels/channel-config.js";
export {
  buildMessagingTarget,
  ensureTargetId,
  normalizeTargetId,
  parseAtUserTarget,
  parseMentionPrefixOrAtUserTarget,
  parseTargetMention,
  parseTargetPrefix,
  parseTargetPrefixes,
  requireTargetKind,
  type MessagingTarget,
  type MessagingTargetKind,
  type MessagingTargetParseOptions,
} from "../channels/targets.js";
// D-CORE-215: the upstream barrel also re-exports the chat-target-prefix
// allow matchers, the channel registry id normalizer, the TTS voice delivery
// resolver and the target resolvers. Those hang off OpenClaw's channel
// registry / plugin host; Fusion's Hub owns registration. The two pure
// modules the ported Slack target parsing reads are carried whole.
