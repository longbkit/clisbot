export default {
  channel: "api",
  interactionRenderer: "plain",
  routeIdSyntax: "dm:<surface-id>, dm:*, group:<surface-id>, or group:*",
  supportsGroups: true,
  supportsTopics: false,
  legacyGroupAliases: [],
  normalizeUserId(providerUserId: string) {
    return providerUserId.trim();
  },
} as const;
