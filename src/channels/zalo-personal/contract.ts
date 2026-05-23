export default {
  channel: "zalo-personal",
  interactionRenderer: "plain",
  routeIdSyntax: "dm:<id>, dm:*, group:<id>, or group:*",
  supportsGroups: true,
  supportsTopics: false,
  legacyGroupAliases: [],
  normalizeUserId(providerUserId: string) {
    return providerUserId.trim();
  },
} as const;
