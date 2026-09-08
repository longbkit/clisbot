// upstream: src/plugin-sdk/status-helpers.ts@5d8067a4483
// Channel status/reaction-level helpers.
export {
  resolveReactionLevel,
  type ReactionLevel,
  type ResolvedReactionLevel,
  type ResolvedReactionLevel as BaseResolvedReactionLevel,
} from "../utils/reaction-level.js";
// D-CORE-221: the upstream barrel is the channel status-surface universe
// (account-state issue builders, plugin status adapters, the typed
// `OpenClawConfig` status sections). The port stops at that host boundary; the
// Hub owns channel status.
