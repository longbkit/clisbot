import { renderCliCommand } from "../../control/commands/cli-name.ts";

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
    "Ask the bot owner to do this first:",
    "",
    "Add the whole group route:",
    renderCliCommand(`routes add --channel telegram group:${chatId} --bot default`, { inline: true }),
    "That group will use the agent currently assigned to that bot by default.",
    "",
    "Only if that group should use a different agent than the one currently assigned to that bot by default:",
    renderCliCommand(`routes set-agent --channel telegram group:${chatId} --bot default --agent <id>`, { inline: true }),
  ];

  if (topicId != null) {
    lines.push(
      "",
      "Or add only this topic route:",
      renderCliCommand(`routes add --channel telegram topic:${chatId}:${topicId} --bot default`, { inline: true }),
      "That topic will use the agent currently assigned to that bot by default.",
      "",
      "Only if this topic should use a different agent than the one currently assigned to that bot by default:",
      renderCliCommand(`routes set-agent --channel telegram topic:${chatId}:${topicId} --bot default --agent <id>`, { inline: true }),
    );
  }

  if (params.includeConfigPath) {
    lines.push(
      "",
      topicId != null
        ? `Config path: \`bots.telegram.default.groups.\"${chatId}\".topics.\"${topicId}\"\``
        : `Config path: \`bots.telegram.default.groups.\"${chatId}\"\``,
    );
  } else {
    lines.push(
      "",
      "After that, routed commands such as `/status`, `/mention`, `/stop`, `/nudge`, `/followup`, and `/bash` will work here.",
    );
  }

  return lines.join("\n");
}
