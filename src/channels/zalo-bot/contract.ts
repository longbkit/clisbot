export default {
  channel: "zalo-bot",
  interactionRenderer: "plain",
  routeIdSyntax: "dm:<id> or dm:*",
  supportsGroups: false,
  supportsTopics: false,
  legacyGroupAliases: [],
  normalizeUserId(providerUserId: string) {
    return providerUserId.trim();
  },
} as const;
