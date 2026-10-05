export const CHANNEL_ROUTE_TARGET_VALUES = ["agent", "automation"];

/** New Routes reply in a thread; editing retains the saved or legacy default. */
export function initialChannelReplyAnchor(
  isEditing: boolean,
  anchor: unknown,
): "thread" | "default" {
  if (!isEditing) return "thread";
  return anchor === "thread" ? "thread" : "default";
}

/**
 * A new Route replies in a thread in DMs too. An edited one keeps its stored
 * `reply.dmAnchor`, absent when it never set one, so the Hub's default still
 * applies there.
 */
export function initialDmReplyAnchor(
  isEditing: boolean,
  anchor: unknown,
): { dmReplyAnchor?: "thread" | "default" } {
  if (!isEditing) return { dmReplyAnchor: "thread" };
  return anchor === "thread" || anchor === "default" ? { dmReplyAnchor: anchor } : {};
}

/** New Routes start an Agent; editing keeps the saved target. */
export function initialChannelRouteTarget(
  isEditing: boolean,
  workflow: string | null,
): "agent" | "automation" {
  return isEditing && workflow !== null ? "automation" : "agent";
}

/** Only a confirmed one-member owner organization earns this personal-use label. */
export function channelMembersAudienceLabel(input: {
  membership: { id: string; role: string } | null;
  members: readonly { id: string; role: string }[] | undefined;
  selectedTeamIds: readonly string[];
}): "Only you" | "Members with access" {
  return input.membership?.role === "owner" &&
    input.members?.length === 1 &&
    input.members[0]?.id === input.membership.id &&
    input.members[0].role === "owner" &&
    input.selectedTeamIds.length === 0
    ? "Only you"
    : "Members with access";
}
