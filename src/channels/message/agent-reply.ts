import { renderCliCommand } from "../../control/commands/cli-name.ts";

export function renderAgentReplyCommandBase(params: {
  command: string;
  channel: string;
  botId?: string;
  target: string;
  childSurface?: {
    flag: string;
    value: string;
  } | null;
  inputFormat: string;
  renderMode: string;
}) {
  return [
    `${params.command} message send \\`,
    `  --channel ${params.channel} \\`,
    params.botId ? `  --bot ${params.botId} \\` : null,
    `  --target ${params.target} \\`,
    params.childSurface
      ? `  ${params.childSurface.flag} ${params.childSurface.value} \\`
      : null,
    `  --input ${params.inputFormat} \\`,
    `  --render ${params.renderMode} \\`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderMarkdownReplyStyleHint(limitLine: string) {
  return [
    "Put readable hierarchical Markdown in the --message body.",
    "For clickable links, use canonical URLs and do not wrap them in backticks.",
    limitLine,
  ].join("\n");
}

export function renderPlainTextReplyStyleHint(limitLine: string) {
  return [
    "Use plain text with clear structure, especially for longer replies.",
    "For clickable links, use canonical URLs and do not wrap them in backticks.",
    limitLine,
  ].join("\n");
}

export function renderScopedQueueHelpCommand(channel: string) {
  return renderCliCommand(`queues --help --channel ${channel}`, { inline: true });
}
