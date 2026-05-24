export function createDefaultZaloPersonalDirectMessages() {
  return {
    "*": {
      enabled: true,
      requireMention: false,
      policy: "allowlist" as const,
      allowUsers: [],
      blockUsers: [],
      allowBots: false,
    },
  };
}
