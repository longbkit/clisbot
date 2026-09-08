// upstream: extensions/googlechat/src/group-policy.ts@5d8067a4483
import {
  buildChannelGroupsScopeTree,
  resolveScopeRequireMention,
  type ScopeTree,
} from "@getpaseo/channels-core/plugin-sdk/channel-policy";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";

type GroupContext = { cfg: OpenClawConfig; accountId?: string | null; groupId?: string | null };

export function buildGoogleChatGroupPolicyScope(params: {
  tree: ScopeTree;
  groupId?: string | null;
}) {
  const matchKey =
    params.groupId && Object.hasOwn(params.tree.scopes, params.groupId)
      ? params.groupId
      : undefined;
  return { tree: params.tree, path: matchKey ? [matchKey] : [], matchKey };
}

export function resolveGoogleChatGroupRequireMention(params: GroupContext): boolean {
  return resolveScopeRequireMention(
    buildGoogleChatGroupPolicyScope({
      tree: buildChannelGroupsScopeTree(params.cfg, "googlechat", params.accountId),
      groupId: params.groupId,
    }),
  );
}
