export function normalizeSlackReactionName(value?: string | null) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/^:+|:+$/g, "").trim();
  return normalized || null;
}

type SlackReactionClient = {
  reactions: {
    add(args: {
      channel: string;
      name: string;
      timestamp: string;
    }): Promise<unknown>;
    remove(args: {
      channel: string;
      name: string;
      timestamp: string;
    }): Promise<unknown>;
  };
};

const loggedReactionWarnings = new Set<string>();

function isSlackReactionConflict(error: unknown, code: string) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { data?: { error?: unknown }; code?: unknown };
  return candidate.data?.error === code || candidate.code === code;
}

function logSlackReactionWarningOnce(message: string) {
  if (loggedReactionWarnings.has(message)) {
    return;
  }

  loggedReactionWarnings.add(message);
  console.warn(message);
}

function getSlackReactionErrorMetadata(error: unknown) {
  if (!error || typeof error !== "object") {
    return {};
  }

  const candidate = error as {
    data?: { error?: unknown; needed?: unknown };
    code?: unknown;
  };
  return {
    platformError: candidate.data?.error,
    neededScope: candidate.data?.needed,
    code: candidate.code,
  };
}

export async function addConfiguredReaction(
  client: SlackReactionClient,
  reactionValue: string | undefined,
  target: { channel: string; timestamp?: string },
) {
  const reactionName = normalizeSlackReactionName(reactionValue);
  if (!reactionName || !target.timestamp) {
    return false;
  }

  try {
    await client.reactions.add({
      channel: target.channel,
      name: reactionName,
      timestamp: target.timestamp,
    });
    return true;
  } catch (error) {
    if (isSlackReactionConflict(error, "already_reacted")) {
      return false;
    }
    const metadata = getSlackReactionErrorMetadata(error);
    if (
      metadata.platformError === "missing_scope" &&
      typeof metadata.neededScope === "string"
    ) {
      logSlackReactionWarningOnce(
        `slack reactions disabled: missing scope ${metadata.neededScope}`,
      );
      return false;
    }
    console.error("slack reaction add failed", error);
    return false;
  }
}

export async function removeConfiguredReaction(
  client: SlackReactionClient,
  reactionValue: string | undefined,
  target: { channel: string; timestamp?: string },
) {
  const reactionName = normalizeSlackReactionName(reactionValue);
  if (!reactionName || !target.timestamp) {
    return false;
  }

  try {
    await client.reactions.remove({
      channel: target.channel,
      name: reactionName,
      timestamp: target.timestamp,
    });
    return true;
  } catch (error) {
    if (isSlackReactionConflict(error, "no_reaction")) {
      return false;
    }
    const metadata = getSlackReactionErrorMetadata(error);
    if (
      metadata.platformError === "missing_scope" &&
      typeof metadata.neededScope === "string"
    ) {
      logSlackReactionWarningOnce(
        `slack reactions disabled: missing scope ${metadata.neededScope}`,
      );
      return false;
    }
    console.error("slack reaction remove failed", error);
    return false;
  }
}
