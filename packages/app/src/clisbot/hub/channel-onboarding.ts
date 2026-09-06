export const CHANNEL_ROUTE_TARGET_VALUES = ["automation", "agent"];

/** New Routes reply in a thread; editing retains the saved or legacy default. */
export function initialChannelReplyAnchor(
  isEditing: boolean,
  anchor: unknown,
): "thread" | "default" {
  if (!isEditing) return "thread";
  return anchor === "thread" ? "thread" : "default";
}

export function initialChannelRouteTarget(
  isEditing: boolean,
  workflow: string | null,
): "agent" | "automation" {
  return isEditing && workflow === null ? "agent" : "automation";
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
