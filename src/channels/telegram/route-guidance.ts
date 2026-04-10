export function renderTelegramRouteChoiceMessage(params: {
  chatId: number | string;
  topicId?: number | string;
  includeConfigPath?: boolean;
}) {
  const chatId = String(params.chatId);
  const topicId = params.topicId != null ? String(params.topicId) : undefined;
  const lines = [
    topicId != null
      ? "clisbot: this Telegram topic is not configured yet."
      : "clisbot: this Telegram group is not configured yet.",
    "",
    "Ask the bot owner to choose one of these:",
    "",
    "Add the whole group with the default agent:",
    `\`clisbot channels add telegram-group ${chatId}\``,
    "",
    "Add the whole group with a specific agent:",
    `\`clisbot channels add telegram-group ${chatId} --agent <id>\``,
  ];

  if (topicId != null) {
    lines.push(
      "",
      "Add only this topic with a specific agent:",
      `\`clisbot channels add telegram-group ${chatId} --topic ${topicId} --agent <id>\``,
    );
  }

  if (params.includeConfigPath) {
    lines.push(
      "",
      topicId != null
        ? `Config path: \`channels.telegram.groups.\"${chatId}\".topics.\"${topicId}\"\``
        : `Config path: \`channels.telegram.groups.\"${chatId}\"\``,
    );
  } else {
    lines.push(
      "",
      "After that, routed commands such as `/status`, `/stop`, `/followup`, and `/bash` will work here.",
    );
  }

  return lines.join("\n");
}
