export type FollowUpMode = "auto" | "mention-only" | "paused";

export type FollowUpConfig = {
  mode: FollowUpMode;
  participationTtlMs: number;
};

export type StoredFollowUpState = {
  overrideMode?: FollowUpMode;
  lastBotReplyAt?: number;
};

export function resolveFollowUpMode(params: {
  defaultMode: FollowUpMode;
  overrideMode?: FollowUpMode;
}) {
  return params.overrideMode ?? params.defaultMode;
}

export function isImplicitFollowUpAllowed(params: {
  mode: FollowUpMode;
  participationTtlMs: number;
  lastBotReplyAt?: number;
  directReplyToBot?: boolean;
  now?: number;
}) {
  if (params.mode !== "auto") {
    return false;
  }

  if (params.directReplyToBot) {
    return true;
  }

  if (typeof params.lastBotReplyAt !== "number" || !Number.isFinite(params.lastBotReplyAt)) {
    return false;
  }

  return (params.now ?? Date.now()) - params.lastBotReplyAt <= params.participationTtlMs;
}

export function shouldReactivateFollowUpOnExplicitMention(params: {
  overrideMode?: FollowUpMode;
  explicitlyMentioned: boolean;
}) {
  return params.overrideMode === "paused" && params.explicitlyMentioned;
}

export function formatFollowUpTtlMinutes(ttlMs: number) {
  const minutes = ttlMs / 60_000;
  if (Number.isInteger(minutes)) {
    return `${minutes}`;
  }
  return minutes.toFixed(2).replace(/\.?0+$/, "");
}
