import type { ChannelIdentity } from "./channel-identity.ts";
import { getClisbotPromptCommand } from "../control/clisbot-wrapper.ts";

export type ChannelAgentPromptConfig = {
  enabled: boolean;
  maxProgressMessages: number;
  requireFinalResponse: boolean;
};

export function buildAgentPromptText(params: {
  text: string;
  identity: ChannelIdentity;
  config: ChannelAgentPromptConfig;
  cliTool?: "codex" | "claude" | "gemini";
  responseMode?: "capture-pane" | "message-tool";
  streaming?: "off" | "latest" | "all";
  protectedControlMutationRule?: string;
}) {
  if (!params.config.enabled) {
    return params.text;
  }

  const systemBlock = renderAgentPromptInstruction(params);
  return `<system>\n${systemBlock}\n</system>\n\n<user>\n${params.text}\n</user>`;
}

function renderAgentPromptInstruction(params: {
  identity: ChannelIdentity;
  config: ChannelAgentPromptConfig;
  cliTool?: "codex" | "claude" | "gemini";
  responseMode?: "capture-pane" | "message-tool";
  streaming?: "off" | "latest" | "all";
  protectedControlMutationRule?: string;
}) {
  const messageToolMode = (params.responseMode ?? "message-tool") === "message-tool";
  const progressAllowed = messageToolMode && (params.streaming ?? "off") === "off";
  const lines = [
    `[${renderPromptTimestamp()}] ${renderIdentitySummary(params.identity)}`,
    "",
    "You are operating inside clisbot.",
    messageToolMode
      ? progressAllowed
        ? "To send a user-visible progress update or final reply, use the following CLI command:"
        : "To send the final user-visible reply, use the following CLI command:"
      : "channel auto-delivery remains enabled for this conversation; do not send user-facing progress updates or the final response with clisbot message send",
  ];

  if (messageToolMode) {
    const replyCommand = buildReplyCommand({
      command: getClisbotPromptCommand(),
      identity: params.identity,
    });
    lines.push(
      replyCommand,
      "When replying to the user:",
      "- put the user-facing message inside the --message body of that command",
      progressAllowed
        ? "- use that command to send progress updates and the final reply back to the conversation"
        : "- use that command only for the final user-facing reply",
      ...(progressAllowed
        ? [`- send at most ${params.config.maxProgressMessages} progress updates`]
        : ["- do not send user-facing progress updates for this conversation"]),
      params.config.requireFinalResponse
        ? "- send exactly 1 final user-facing response"
        : "- final response is optional",
      ...(progressAllowed
        ? [
            "- keep progress updates short and meaningful",
            "- do not send progress updates for trivial internal steps",
          ]
        : []),
    );
  }

  if (params.protectedControlMutationRule) {
    lines.push("", params.protectedControlMutationRule);
  }

  return lines.join("\n");
}

function renderPromptTimestamp() {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  });
  return formatter.format(date).replace(",", "");
}

function renderIdentitySummary(identity: ChannelIdentity) {
  const segments = [renderConversationSummary(identity)];
  const sender = renderSenderSummary(identity);
  if (sender) {
    segments.push(sender);
  }
  return segments.join(" | ");
}

function renderConversationSummary(identity: ChannelIdentity) {
  if (identity.platform === "slack") {
    const scopeLabel =
      identity.conversationKind === "dm"
        ? "Slack direct message"
        : identity.conversationKind === "group"
          ? "Slack group"
          : "Slack channel";
    const segments = [scopeLabel];
    const channel = renderLabeledTarget(identity.channelName, identity.channelId, "#");
    if (channel) {
      segments.push(channel);
    }
    if (identity.threadTs) {
      segments.push(`thread ${identity.threadTs}`);
    }
    return segments.join(" ");
  }

  if (identity.conversationKind === "dm") {
    return ["Telegram direct message", renderLabeledTarget(identity.chatName, identity.chatId)]
      .filter(Boolean)
      .join(" ");
  }

  if (identity.conversationKind === "topic") {
    const topic = renderNamedValue("topic", identity.topicName, identity.topicId);
    const group = renderNamedValue("in group", identity.chatName, identity.chatId);
    return [topic, group].filter(Boolean).join(" ");
  }

  return ["Telegram group", renderLabeledTarget(identity.chatName, identity.chatId)]
    .filter(Boolean)
    .join(" ");
}

function renderSenderSummary(identity: ChannelIdentity) {
  const sender = renderLabeledTarget(identity.senderName, identity.senderId);
  return sender ? `sender ${sender}` : "";
}

function renderLabeledTarget(name?: string, id?: string, namePrefix = "") {
  const normalizedName = name?.trim();
  const normalizedId = id?.trim();
  if (normalizedName && normalizedId) {
    return `${namePrefix}${normalizedName} (${normalizedId})`;
  }
  if (normalizedName) {
    return `${namePrefix}${normalizedName}`;
  }
  return normalizedId ?? "";
}

function renderNamedValue(label: string, name?: string, id?: string) {
  const value = renderLabeledTarget(name, id);
  return value ? `${label} ${value}` : "";
}

function buildReplyCommand(params: {
  command: string;
  identity: ChannelIdentity;
}) {
  const lines = [`${params.command} message send \\`];
  if (params.identity.platform === "slack") {
    lines.push("  --channel slack \\");
    lines.push(`  --target channel:${params.identity.channelId ?? ""} \\`);
    if (params.identity.threadTs) {
      lines.push(`  --thread-id ${params.identity.threadTs} \\`);
    }
    lines.push("  --final \\");
    lines.push('  --message "$(cat <<\\__CLISBOT_MESSAGE__');
    lines.push("<user-facing reply>");
    lines.push("__CLISBOT_MESSAGE__");
    lines.push(')" \\');
    lines.push("  [--media /absolute/path/to/file]");
    return lines.join("\n");
  }

  lines.push("  --channel telegram \\");
  lines.push(`  --target ${params.identity.chatId ?? ""} \\`);
  if (params.identity.topicId) {
    lines.push(`  --thread-id ${params.identity.topicId} \\`);
  }
  lines.push("  --final \\");
  lines.push('  --message "$(cat <<\\__CLISBOT_MESSAGE__');
  lines.push("<user-facing reply>");
  lines.push("__CLISBOT_MESSAGE__");
  lines.push(')" \\');
  lines.push("  [--media /absolute/path/to/file]");
  return lines.join("\n");
}
