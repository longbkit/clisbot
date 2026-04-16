import type { ChannelIdentity } from "./channel-identity.ts";
import { getClisbotPromptCommand } from "../control/clisbot-wrapper.ts";

export type ChannelAgentPromptConfig = {
  enabled: boolean;
  maxProgressMessages: number;
  requireFinalResponse: boolean;
};

export const CONFIGURATION_GUIDANCE =
  "When the user asks to change clisbot configuration, use clisbot CLI commands; see `clisbot --help`, `clisbot channels --help`, or `clisbot auth --help` for details.";

export const BASE_TEMPLATE = `<system>
[{{timestamp}}] {{identity_summary}}

You are operating inside clisbot.
{{delivery_intro}}
{{reply_command}}
{{reply_rules}}
${CONFIGURATION_GUIDANCE}{{protected_control_suffix}}
</system>

<user>
{{message_body}}
</user>`;

export const STEERING_TEMPLATE = `<system>
A new user message arrived while you were still working.
Adjust your current work if needed and continue.{{protected_control_suffix}}
</system>

<user>
{{message_body}}
</user>`;

export const DELIVERY_INTRO =
  "To send a user-visible {{progress_phrase}}final reply, use the following CLI command:";

export const DELIVERY_INTRO_CAPTURE_PANE =
  "channel auto-delivery remains enabled for this conversation; do not send user-facing progress updates or the final response with clisbot message send";

export const REPLY_COMMAND = `{{reply_command_base}}
  --final{{progress_flag_suffix}} \\
  --message "$(cat <<\\__CLISBOT_MESSAGE__
<user-facing reply>
__CLISBOT_MESSAGE__
)" \\
  [--media /absolute/path/to/file]`;

export const REPLY_RULES = `When replying to the user:
- put the user-facing message inside the --message body of that command
{{progress_rules_block}}- {{final_rule_line}}`;

export const PROGRESS_PHRASE = "progress update or ";
export const EMPTY_PROGRESS_PHRASE = "";

export const PROGRESS_FLAG_SUFFIX = "|progress";
export const EMPTY_PROGRESS_FLAG_SUFFIX = "";

export const PROGRESS_RULES_BLOCK = `- use that command to send progress updates and the final reply back to the conversation
- send at most {{max_progress_messages}} progress updates
- keep progress updates short and meaningful
- do not send progress updates for trivial internal steps
`;

export const FINAL_ONLY_RULES_BLOCK = `- use that command only for the final user-facing reply
- do not send user-facing progress updates for this conversation
`;

export const FINAL_RULE_REQUIRED = "send exactly 1 final user-facing response";
export const FINAL_RULE_OPTIONAL = "final response is optional";

export const EMPTY_REPLY_COMMAND = "";
export const EMPTY_REPLY_RULES = "";

export const SLACK_REPLY_COMMAND_BASE = `{{command}} message send \\
  --channel slack \\
{{account_clause}}  --target channel:{{channel_id}} \\
{{thread_clause}}`;

export const TELEGRAM_REPLY_COMMAND_BASE = `{{command}} message send \\
  --channel telegram \\
{{account_clause}}  --target {{chat_id}} \\
{{thread_clause}}`;

export const ACCOUNT_CLAUSE = "  --account {{account_id}} \\\n";
export const EMPTY_ACCOUNT_CLAUSE = "";

export const SLACK_THREAD_CLAUSE = "  --thread-id {{thread_ts}} \\\n";
export const TELEGRAM_THREAD_CLAUSE = "  --thread-id {{topic_id}} \\\n";
export const EMPTY_THREAD_CLAUSE = "";

type ChannelPromptMode = "message" | "steer";

export function buildAgentPromptText(params: {
  text: string;
  identity: ChannelIdentity;
  config: ChannelAgentPromptConfig;
  cliTool?: "codex" | "claude" | "gemini";
  responseMode?: "capture-pane" | "message-tool";
  streaming?: "off" | "latest" | "all";
  protectedControlMutationRule?: string;
}) {
  return buildChannelPromptText({
    ...params,
    mode: "message",
  });
}

export function buildSteeringPromptText(params: {
  text: string;
  protectedControlMutationRule?: string;
}) {
  return buildChannelPromptText({
    text: params.text,
    mode: "steer",
    protectedControlMutationRule: params.protectedControlMutationRule,
  });
}

function buildChannelPromptText(params: {
  text: string;
  identity?: ChannelIdentity;
  config?: ChannelAgentPromptConfig;
  responseMode?: "capture-pane" | "message-tool";
  streaming?: "off" | "latest" | "all";
  protectedControlMutationRule?: string;
  mode: ChannelPromptMode;
}) {
  if (params.mode === "message" && !params.config?.enabled) {
    return params.text;
  }

  if (params.mode === "steer") {
    return renderTemplate(STEERING_TEMPLATE, {
      message_body: params.text,
      protected_control_suffix: renderProtectedControlSuffix(
        params.protectedControlMutationRule,
      ),
    });
  }

  const promptParts = renderMessagePromptParts({
    identity: params.identity!,
    config: params.config!,
    responseMode: params.responseMode,
    streaming: params.streaming,
  });

  return renderTemplate(BASE_TEMPLATE, {
    timestamp: renderPromptTimestamp(),
    identity_summary: renderIdentitySummary(params.identity!),
    delivery_intro: promptParts.deliveryIntro,
    reply_command: promptParts.replyCommand,
    reply_rules: promptParts.replyRules,
    protected_control_suffix: renderProtectedControlSuffix(
      params.protectedControlMutationRule,
    ),
    message_body: params.text,
  });
}

function renderMessagePromptParts(params: {
  identity: ChannelIdentity;
  config: ChannelAgentPromptConfig;
  responseMode?: "capture-pane" | "message-tool";
  streaming?: "off" | "latest" | "all";
}) {
  const messageToolMode = (params.responseMode ?? "message-tool") === "message-tool";
  if (!messageToolMode) {
    return {
      deliveryIntro: DELIVERY_INTRO_CAPTURE_PANE,
      replyCommand: EMPTY_REPLY_COMMAND,
      replyRules: EMPTY_REPLY_RULES,
    };
  }

  const allowProgress = (params.streaming ?? "off") === "off";
  const progressPhrase = allowProgress ? PROGRESS_PHRASE : EMPTY_PROGRESS_PHRASE;
  const progressFlagSuffix = allowProgress ? PROGRESS_FLAG_SUFFIX : EMPTY_PROGRESS_FLAG_SUFFIX;
  const progressRulesBlock = allowProgress ? PROGRESS_RULES_BLOCK : FINAL_ONLY_RULES_BLOCK;
  const finalRuleLine = params.config.requireFinalResponse
    ? FINAL_RULE_REQUIRED
    : FINAL_RULE_OPTIONAL;

  return {
    deliveryIntro: renderTemplate(DELIVERY_INTRO, {
      progress_phrase: progressPhrase,
    }),
    replyCommand: renderTemplate(REPLY_COMMAND, {
      reply_command_base: buildReplyCommandBase({
        command: getClisbotPromptCommand(),
        identity: params.identity,
      }).trimEnd(),
      progress_flag_suffix: progressFlagSuffix,
    }),
    replyRules: renderTemplate(REPLY_RULES, {
      progress_rules_block: renderTemplate(progressRulesBlock, {
        max_progress_messages: String(params.config.maxProgressMessages),
      }),
      final_rule_line: finalRuleLine,
    }),
  };
}

function renderProtectedControlSuffix(rule?: string) {
  if (!rule) {
    return "";
  }

  return `\n\n${rule}`;
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replaceAll(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => values[key] ?? "");
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

function buildReplyCommandBase(params: {
  command: string;
  identity: ChannelIdentity;
}) {
  if (params.identity.platform === "slack") {
    return renderTemplate(SLACK_REPLY_COMMAND_BASE, {
      command: params.command,
      account_clause: params.identity.accountId
        ? renderTemplate(ACCOUNT_CLAUSE, {
          account_id: params.identity.accountId,
        })
        : EMPTY_ACCOUNT_CLAUSE,
      channel_id: params.identity.channelId ?? "",
      thread_clause: params.identity.threadTs
        ? renderTemplate(SLACK_THREAD_CLAUSE, {
          thread_ts: params.identity.threadTs,
        })
        : EMPTY_THREAD_CLAUSE,
    });
  }

  return renderTemplate(TELEGRAM_REPLY_COMMAND_BASE, {
    command: params.command,
    account_clause: params.identity.accountId
      ? renderTemplate(ACCOUNT_CLAUSE, {
        account_id: params.identity.accountId,
      })
      : EMPTY_ACCOUNT_CLAUSE,
    chat_id: params.identity.chatId ?? "",
    thread_clause: params.identity.topicId
      ? renderTemplate(TELEGRAM_THREAD_CLAUSE, {
        topic_id: params.identity.topicId,
      })
      : EMPTY_THREAD_CLAUSE,
  });
}
