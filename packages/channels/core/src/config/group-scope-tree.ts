// upstream: src/config/group-scope-tree.ts@5d8067a4483
// D-CORE-222: upstream also owns the scope-path encoder/matcher used by the
// OpenClaw group-policy resolver. The ported Telegram code only builds a scope
// tree to select a group entry, so the shape is carried and the matcher is not.

/** One scope entry. Channels put their per-group/per-DM config object here. */
export type ScopeNode = Record<string, unknown>;

export type ScopeTree = {
  defaults?: ScopeNode;
  // Flat keys preserve channel-defined precedence: channels emit broad-to-narrow paths.
  // Nested trees cannot model Telegram, where a wildcard-group topic outranks
  // an exact-group scalar requireMention.
  scopes: Record<string, ScopeNode>;
};

// Slice 10b additions (Slack group-policy port): the two scope resolvers the
// ported Slack channel policy calls, carried with upstream's bodies. Upstream's
// `resolveScopeToolsPolicy` also consults `resolveToolsBySender` from
// `src/config/group-policy.ts` (the OpenClaw sender-policy resolver the port
// stops at, D-CORE-222); the sender branch resolves to the node's own `tools`
// here and the sender fields stay in the signature.
export type ScopePath = string[];

// Slice 13 additions (Discord vertical port): the scope-key encoder the ported
// Discord group-policy builder uses, carried with upstream's bodies.
export const encodeScopeSegment = (value: string) => `${value.length}:${value}`;

export function scopeKey(...segments: Array<readonly [prefix: string, value: string]>): string {
  return segments.map(([prefix, value]) => `${prefix}:${encodeScopeSegment(value)}`).join("/");
}

type ScopeToolPolicySender = {
  senderPolicyMode?: "always" | "never";
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
  messageProvider?: string;
};

function resolveFromScopes<T>(params: {
  tree: ScopeTree;
  path: ScopePath;
  resolveNode: (node: ScopeNode) => T | undefined;
}): T | undefined {
  // Upstream walks the path from the END: channels emit broad-to-narrow paths,
  // so the narrowest scope that carries the field wins. Slice 13 restored this
  // (a forward walk let a Discord guild policy beat its own channel policy);
  // Slack passes a single-element path, so its behavior is unchanged.
  for (let index = params.path.length - 1; index >= 0; index -= 1) {
    const key = params.path[index];
    if (key === undefined || !Object.hasOwn(params.tree.scopes, key)) {
      continue;
    }
    const node = params.tree.scopes[key];
    if (!node) {
      continue;
    }
    const value = params.resolveNode(node);
    if (value !== undefined) {
      return value;
    }
  }
  return params.tree.defaults ? params.resolveNode(params.tree.defaults) : undefined;
}

export function resolveScopeRequireMention(params: {
  tree: ScopeTree;
  path: ScopePath;
  requireMentionOverride?: boolean;
  overrideOrder?: "before-config" | "after-config";
  configuredScopeDefaultsToNoMention?: boolean;
}): boolean {
  // Runtime overrides stay in resolver parameters because channels derive them per message.
  const { requireMentionOverride, overrideOrder = "after-config" } = params;
  const configuredMention = resolveFromScopes({
    tree: params.tree,
    path: params.path,
    resolveNode: (node) => node.requireMention as boolean | undefined,
  });

  if (overrideOrder === "before-config" && typeof requireMentionOverride === "boolean") {
    return requireMentionOverride;
  }
  if (typeof configuredMention === "boolean") {
    return configuredMention;
  }
  if (overrideOrder !== "before-config" && typeof requireMentionOverride === "boolean") {
    return requireMentionOverride;
  }
  if (
    params.configuredScopeDefaultsToNoMention &&
    params.path.some((key) => Object.hasOwn(params.tree.scopes, key))
  ) {
    return false;
  }
  return true;
}

export function resolveScopeToolsPolicy(
  params: {
    tree: ScopeTree;
    path: ScopePath;
  } & ScopeToolPolicySender,
): Record<string, unknown> | undefined {
  return resolveFromScopes({
    tree: params.tree,
    path: params.path,
    resolveNode: (node) => node.tools as Record<string, unknown> | undefined,
  });
}

// Slice 14 addition (Google Chat vertical port): upstream's
// `buildChannelGroupsScopeTree` reads the channel's `groups` map through
// `resolveChannelGroups` from `src/config/group-policy.ts` — the 548-line
// OpenClaw group-policy resolver the port stops at (D-CORE-222). The lookup it
// performs (account entry first, then the channel section) is inlined here; the
// wildcard-to-defaults split below is upstream's.
type ChannelGroupsSection = {
  groups?: Record<string, ScopeNode>;
  accounts?: Record<string, { groups?: Record<string, ScopeNode> } | undefined>;
};

export function buildChannelGroupsScopeTree(
  cfg: { channels?: Record<string, unknown> },
  channel: string,
  accountId?: string | null,
): ScopeTree {
  const section = cfg.channels?.[channel] as ChannelGroupsSection | undefined;
  const accountGroups =
    accountId === undefined || accountId === null
      ? undefined
      : section?.accounts?.[accountId]?.groups;
  const groups = accountGroups ?? section?.groups ?? {};
  // The wildcard config is the fallback node, not a matchable exact scope.
  const { "*": defaults, ...scopes } = groups;
  return { ...(defaults === undefined ? {} : { defaults }), scopes };
}

