export default {
  channel: "telegram",
  interactionRenderer: "plain",
  routeIdSyntax: "group:<chatId>, topic:<chatId>:<topicId>, group:*, or dm:<id|*>",
  supportsTopics: true,
  legacyGroupAliases: [],
  normalizeUserId(providerUserId: string) {
    return providerUserId.trim();
  },
} as const;
