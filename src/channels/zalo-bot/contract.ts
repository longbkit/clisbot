export default {
  channel: "zalo-bot",
  interactionRenderer: "plain",
  routeIdSyntax: "dm:<id>, dm:*, group:<chatId>, or group:*",
  supportsTopics: false,
  legacyGroupAliases: [],
  normalizeUserId(providerUserId: string) {
    return providerUserId.trim();
  },
} as const;
