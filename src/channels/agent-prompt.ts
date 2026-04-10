import type { ChannelInteractionIdentity } from "./interaction-processing.ts";
import { getClisbotWrapperPath } from "../control/clisbot-wrapper.ts";

export type ChannelAgentPromptConfig = {
  enabled: boolean;
  maxProgressMessages: number;
  requireFinalResponse: boolean;
};

export function buildAgentPromptText(params: {
  text: string;
  identity: ChannelInteractionIdentity;
  config: ChannelAgentPromptConfig;
  responseMode?: "capture-pane" | "message-tool";
}) {
  if (!params.config.enabled) {
    return params.text;
  }

  const systemBlock = renderAgentPromptInstruction(params);
  return `<system>\n${systemBlock}\n</system>\n\n<user>\n${params.text}\n</user>`;
}

function renderAgentPromptInstruction(params: {
  identity: ChannelInteractionIdentity;
  config: ChannelAgentPromptConfig;
  responseMode?: "capture-pane" | "message-tool";
}) {
  const messageToolMode = (params.responseMode ?? "message-tool") === "message-tool";
  const lines = [
    `[${renderPromptTimestamp()}] ${renderIdentitySummary(params.identity)}`,
    "",
    "You are operating inside clisbot.",
    messageToolMode
      ? "channel auto-delivery is disabled for this conversation; send user-facing progress updates and the final response yourself with the reply command"
      : "channel auto-delivery remains enabled for this conversation; do not send user-facing progress updates or the final response with clisbot message send",
  ];

  if (messageToolMode) {
    const wrapperPath = getClisbotWrapperPath();
    const replyCommand = buildReplyCommand({
      wrapperPath,
      identity: params.identity,
    });
    lines.push(
      "Use the exact command below when you need to send progress updates, media attachments, or the final response back to the user.",
      "reply command:",
      replyCommand,
      `progress updates: at most ${params.config.maxProgressMessages}`,
      params.config.requireFinalResponse
        ? "final response: send exactly 1 final user-facing response"
        : "final response: optional",
      "keep progress updates short and meaningful",
      "do not send progress updates for trivial internal steps",
    );
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

function renderIdentitySummary(identity: ChannelInteractionIdentity) {
  const segments = [renderConversationSummary(identity)];
  const sender = renderSenderSummary(identity);
  if (sender) {
    segments.push(sender);
  }
  return segments.join(" | ");
}

function renderConversationSummary(identity: ChannelInteractionIdentity) {
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

function renderSenderSummary(identity: ChannelInteractionIdentity) {
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
  wrapperPath: string;
  identity: ChannelInteractionIdentity;
}) {
  const lines = [`${params.wrapperPath} message send \\`];
  if (params.identity.platform === "slack") {
    lines.push("  --channel slack \\");
    lines.push(`  --target channel:${params.identity.channelId ?? ""} \\`);
    if (params.identity.threadTs) {
      lines.push(`  --thread-id ${params.identity.threadTs} \\`);
    }
    lines.push("  --final \\");
    lines.push('  --message "$(cat <<\'__CLISBOT_MESSAGE__\'');
    lines.push("<short progress update>");
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
  lines.push('  --message "$(cat <<\'__CLISBOT_MESSAGE__\'');
  lines.push("<short progress update>");
  lines.push("__CLISBOT_MESSAGE__");
  lines.push(')" \\');
  lines.push("  [--media /absolute/path/to/file]");
  return lines.join("\n");
}
