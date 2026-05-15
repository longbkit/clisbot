export type ChannelId = string;
export type ChannelInteractionRenderer = "markdown" | "plain";

export type ChannelSurfaceContract = {
  channel: ChannelId;
  interactionRenderer: ChannelInteractionRenderer;
  routeIdSyntax: string;
  supportsGroups: boolean;
  supportsTopics: boolean;
  legacyGroupAliases: readonly string[];
  normalizeUserId(providerUserId: string): string;
};

export function buildChannelPrincipal(
  channel: ChannelId,
  providerUserId: string,
) {
  const trimmed = providerUserId.trim();
  return trimmed ? `${channel}:${trimmed}` : "";
}

export function renderDefaultChannelLabel(channel: string) {
  return channel
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
