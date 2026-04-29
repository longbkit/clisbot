export type SlackSurfaceTarget = {
  conversationKind: "dm" | "group" | "channel";
  channelType: "im" | "mpim" | "channel";
  channelId: string;
  userId?: string;
};

function requireSlackTargetId(value: string, prefix: "dm" | "user") {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Missing Slack ${prefix} target`);
  }
  return normalized;
}

function inferSlackSurfaceTarget(channelId: string): SlackSurfaceTarget {
  const normalized = channelId.trim();
  if (!normalized) {
    throw new Error("Missing Slack target");
  }

  if (normalized.startsWith("D")) {
    return {
      conversationKind: "dm",
      channelType: "im",
      channelId: normalized,
    };
  }

  if (normalized.startsWith("G")) {
    return {
      conversationKind: "group",
      channelType: "mpim",
      channelId: normalized,
    };
  }

  return {
    conversationKind: "channel",
    channelType: "channel",
    channelId: normalized,
  };
}

export function normalizeSlackSurfaceTarget(raw: string): SlackSurfaceTarget {
  const target = raw.trim();
  if (!target) {
    throw new Error("Missing Slack target");
  }

  if (target.startsWith("dm:")) {
    const channelId = requireSlackTargetId(target.slice("dm:".length), "dm");
    return {
      conversationKind: "dm",
      channelType: "im",
      channelId,
      userId: channelId.startsWith("U") ? channelId : undefined,
    };
  }

  if (target.startsWith("user:")) {
    const userId = requireSlackTargetId(target.slice("user:".length), "user");
    return {
      conversationKind: "dm",
      channelType: "im",
      channelId: userId,
      userId,
    };
  }

  if (target.startsWith("group:")) {
    return inferSlackSurfaceTarget(target.slice("group:".length));
  }

  if (target.startsWith("channel:")) {
    return inferSlackSurfaceTarget(target.slice("channel:".length));
  }

  return inferSlackSurfaceTarget(target);
}
