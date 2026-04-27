import type { ChannelIdentity } from "./channel-identity.ts";
import { resolveChannelIdentityBotId } from "./channel-identity.ts";
import {
  buildSurfacePromptContext,
  renderPermissionGuidance,
  renderSurfacePromptContext,
  resolveSurfacePromptTime,
  type SurfacePromptContext,
} from "./surface-prompt-context.ts";
import { getClisbotPromptCommand } from "../control/clisbot-wrapper.ts";
import { getRenderedCliName, renderCliCommand } from "../shared/cli-name.ts";

export type ChannelAgentPromptConfig = {
  enabled: boolean;
  maxProgressMessages: number;
  requireFinalResponse: boolean;
};

export const BASE_TEMPLATE = `<system>
{{message_context}}

You are operating inside clisbot.
{{delivery_intro}}
{{reply_command}}
{{reply_rules}}
{{reply_style_hint}}
{{configuration_guidance}}{{permission_guidance}}{{protected_control_suffix}}
</system>

<user>
{{message_body}}
</user>`;

export const STEERING_TEMPLATE = `<system>
A new user message arrived while you were still working.
Adjust your current work if needed and continue.

{{message_context}}{{permission_guidance}}{{protected_control_suffix}}
</system>

<user>
{{message_body}}
</user>`;

export const DELIVERY_INTRO =
  "To send a user-visible {{progress_phrase}}final reply, use the following CLI command:";

export const REPLY_COMMAND = `{{reply_command_base}}
  --final{{progress_flag_suffix}} \\
  --message "$(cat <<\\__CLISBOT_MESSAGE__
<user-facing reply>
__CLISBOT_MESSAGE__
)" \\
  [--file /absolute/path/to/file]`;

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
export const EMPTY_REPLY_STYLE_HINT = "";

export const SLACK_REPLY_COMMAND_BASE = `{{command}} message send \\
  --channel slack \\
{{account_clause}}  --target channel:{{channel_id}} \\
{{thread_clause}}  --input md \\
  --render blocks \\
`;

export const TELEGRAM_REPLY_COMMAND_BASE = `{{command}} message send \\
  --channel telegram \\
{{account_clause}}  --target {{chat_id}} \\
{{thread_clause}}  --input md \\
  --render native \\
`;

export const SLACK_REPLY_STYLE_HINT =
  "Put readable hierarchical Markdown in the --message body.\nKeep each paragraph, list, or code block under 2500 chars.";

export const TELEGRAM_REPLY_STYLE_HINT =
  "Put readable hierarchical Markdown in the --message body.\nKeep the Markdown body under 3000 chars.";

export const ACCOUNT_CLAUSE = "  --account {{account_id}} \\\n";
export const EMPTY_ACCOUNT_CLAUSE = "";

export const SLACK_THREAD_CLAUSE = "  --thread-id {{thread_ts}} \\\n";
export const TELEGRAM_THREAD_CLAUSE = "  --topic-id {{topic_id}} \\\n";
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
  timezone?: string;
  agentId?: string;
  time?: number | string | Date;
  promptContext?: SurfacePromptContext;
  scheduledLoopId?: string;
}) {
  return buildChannelPromptText({
    ...params,
    mode: "message",
  });
}

export function buildSteeringPromptText(params: {
  text: string;
  identity?: ChannelIdentity;
  agentId?: string;
  time?: number | string | Date;
  promptContext?: SurfacePromptContext;
  protectedControlMutationRule?: string;
}) {
  return buildChannelPromptText({
    text: params.text,
    identity: params.identity,
    agentId: params.agentId,
    time: params.time,
    promptContext: params.promptContext,
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
  timezone?: string;
  agentId?: string;
  time?: number | string | Date;
  promptContext?: SurfacePromptContext;
  scheduledLoopId?: string;
  mode: ChannelPromptMode;
}) {
  if (params.mode === "message" && !params.config?.enabled) {
    return params.text;
  }

  if (params.mode === "steer") {
    const context = resolvePromptContext(params);
    return renderTemplate(STEERING_TEMPLATE, {
      message_context: renderSurfacePromptContext(context),
      permission_guidance: renderPermissionGuidanceWithPrefix(context),
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
  const context = resolvePromptContext(params);

  return renderTemplate(BASE_TEMPLATE, {
    message_context: renderSurfacePromptContext(context),
    delivery_intro: promptParts.deliveryIntro,
    reply_command: promptParts.replyCommand,
    reply_rules: promptParts.replyRules,
    reply_style_hint: promptParts.replyStyleHint,
    configuration_guidance: renderConfigurationGuidance(),
    permission_guidance: renderPermissionGuidanceWithPrefix(context),
    protected_control_suffix: renderProtectedControlSuffix(
      params.protectedControlMutationRule,
    ),
    message_body: params.text,
  });
}

function resolvePromptContext(params: {
  identity?: ChannelIdentity;
  agentId?: string;
  time?: number | string | Date;
  promptContext?: SurfacePromptContext;
  scheduledLoopId?: string;
}) {
  if (params.promptContext) {
    return params.promptContext;
  }
  if (!params.identity) {
    return {
      time: resolveSurfacePromptTime(params.time),
      surface: {
        surfaceId: "unknown",
        kind: "channel" as const,
      },
    };
  }
  return buildSurfacePromptContext({
    identity: params.identity,
    agentId: params.agentId,
    time: params.time,
    scheduledLoopId: params.scheduledLoopId,
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
      deliveryIntro: renderCapturePaneDeliveryIntro(),
      replyCommand: EMPTY_REPLY_COMMAND,
      replyRules: EMPTY_REPLY_RULES,
      replyStyleHint: EMPTY_REPLY_STYLE_HINT,
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
    replyStyleHint: buildReplyStyleHint(params.identity),
  };
}

function buildReplyStyleHint(identity: ChannelIdentity) {
  return identity.platform === "slack"
    ? SLACK_REPLY_STYLE_HINT
    : TELEGRAM_REPLY_STYLE_HINT;
}

function renderConfigurationGuidance() {
  const cliName = getRenderedCliName();
  return [
    `When the user asks to change ${cliName} configuration, use ${cliName} CLI commands; see ${renderCliCommand("--help", { inline: true })}, ${renderCliCommand("bots --help", { inline: true })}, ${renderCliCommand("routes --help", { inline: true })}, or ${renderCliCommand("auth --help", { inline: true })} for details.`,
    `For schedule/loop/reminder requests, inspect ${renderCliCommand("loops --help", { inline: true })} and use the loops CLI.`,
  ].join("\n");
}

function renderPermissionGuidanceWithPrefix(context?: SurfacePromptContext) {
  const guidance = renderPermissionGuidance(context);
  return guidance ? `\n${guidance}` : "";
}

function renderCapturePaneDeliveryIntro() {
  return `channel auto-delivery remains enabled for this conversation; do not send user-facing progress updates or the final response with ${renderCliCommand("message send", { inline: true })}`;
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

function buildReplyCommandBase(params: {
  command: string;
  identity: ChannelIdentity;
}) {
  const botId = resolveChannelIdentityBotId(params.identity);
  if (params.identity.platform === "slack") {
    return renderTemplate(SLACK_REPLY_COMMAND_BASE, {
      command: params.command,
      account_clause: botId
        ? renderTemplate(ACCOUNT_CLAUSE, {
          account_id: botId,
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
    account_clause: botId
      ? renderTemplate(ACCOUNT_CLAUSE, {
        account_id: botId,
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
