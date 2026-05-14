export default {
  channel: "slack",
  interactionRenderer: "markdown",
  routeIdSyntax: "group:<id>, group:*, or dm:<id|*>",
  supportsTopics: false,
  legacyGroupAliases: ["channel"],
  normalizeUserId(providerUserId: string) {
    return providerUserId.trim().toUpperCase();
  },
} as const;
