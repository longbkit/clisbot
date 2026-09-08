// upstream: src/plugin-sdk/channel-policy.ts@5d8067a4483
// Group/DM scope contracts shared by channel plugins.
export type {
  GroupToolPolicyBySenderConfig,
  GroupToolPolicyConfig,
} from "../config/types.telegram.js";
export type { ScopeNode, ScopeTree } from "../config/group-scope-tree.js";
// D-CORE-222: the upstream barrel also exports `resolveChannelGroupPolicy`,
// `resolveToolsBySender`, the allow-from matchers, group-policy warnings and
// dangerous-name matching from `src/config/group-policy.ts` (548 lines wired to
// the OpenClaw account-lookup and session-key routing). Fusion's Hub resolves
// the account and the group scope before a send reaches the vertical, so only
// the scope-tree shape the Telegram group config reader walks is carried.

// Slice 10b additions (Slack group-policy port): the scope-tree readers the
// ported Slack channel policy walks.
export { resolveScopeRequireMention, resolveScopeToolsPolicy } from "../config/group-scope-tree.js";

// Slice 13 addition (Discord vertical port): the ported Discord group-policy
// builder encodes its scope keys through the same upstream helper.
export { encodeScopeSegment, scopeKey } from "../config/group-scope-tree.js";

// Slice 14 addition (Google Chat vertical port): the ported Google Chat group
// policy builds its scope tree through upstream's channel-groups builder.
export { buildChannelGroupsScopeTree } from "../config/group-scope-tree.js";

