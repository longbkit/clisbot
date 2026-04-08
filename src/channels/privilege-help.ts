export type PrivilegeSurfaceIdentity = {
  platform: "slack" | "telegram";
  conversationKind: "dm" | "channel" | "group" | "topic";
  senderId?: string;
  channelId?: string;
  chatId?: string;
  topicId?: string;
};

export function renderGenericPrivilegeCommandHelpLines(prefix = "") {
  return [
    `${prefix}Privilege command setup:`,
    `${prefix}  - enable for a Slack route: \`bun run src/main.ts channels privilege enable slack-channel <channelId>\` or \`bun run src/main.ts channels privilege enable slack-group <groupId>\``,
    `${prefix}  - allow a Slack user: \`bun run src/main.ts channels privilege allow-user slack-channel <channelId> <userId>\``,
    `${prefix}  - enable Slack DM privilege commands: \`bun run src/main.ts channels privilege enable slack-dm\``,
    `${prefix}  - allow a Slack DM user: \`bun run src/main.ts channels privilege allow-user slack-dm <userId>\``,
    `${prefix}  - enable for a Telegram route: \`bun run src/main.ts channels privilege enable telegram-group <chatId> [--topic <topicId>]\``,
    `${prefix}  - allow a Telegram user: \`bun run src/main.ts channels privilege allow-user telegram-group <chatId> <userId> [--topic <topicId>]\``,
    `${prefix}  - enable Telegram DM privilege commands: \`bun run src/main.ts channels privilege enable telegram-dm\``,
    `${prefix}  - allow a Telegram DM user: \`bun run src/main.ts channels privilege allow-user telegram-dm <userId>\``,
  ];
}

export function renderPrivilegeCommandHelpLines(
  identity: PrivilegeSurfaceIdentity,
  prefix = "",
) {
  const target = buildPrivilegeCommandTarget(identity);
  if (!target) {
    return [];
  }

  const allowUserSuffix = identity.senderId ? ` ${identity.senderId}` : " <userId>";

  return [
    `${prefix}Operator commands:`,
    `${prefix}  - enable privilege commands: \`bun run src/main.ts channels privilege enable ${target}\``,
    `${prefix}  - allow this user: \`bun run src/main.ts channels privilege allow-user ${target}${allowUserSuffix}\``,
    `${prefix}  - disable privilege commands: \`bun run src/main.ts channels privilege disable ${target}\``,
    `${prefix}  - remove this user: \`bun run src/main.ts channels privilege remove-user ${target}${allowUserSuffix}\``,
  ];
}

export function buildPrivilegeCommandTarget(identity: PrivilegeSurfaceIdentity) {
  if (identity.platform === "slack") {
    if (identity.conversationKind === "dm") {
      return "slack-dm";
    }

    if (identity.conversationKind === "group") {
      return identity.channelId ? `slack-group ${identity.channelId}` : null;
    }

    return identity.channelId ? `slack-channel ${identity.channelId}` : null;
  }

  if (identity.conversationKind === "dm") {
    return "telegram-dm";
  }

  if (!identity.chatId) {
    return null;
  }

  return identity.conversationKind === "topic" && identity.topicId
    ? `telegram-group ${identity.chatId} --topic ${identity.topicId}`
    : `telegram-group ${identity.chatId}`;
}
