import type { Agent } from "@/stores/session-store";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";

export type ClientSlashCommandKind =
  | "archive-agent"
  | "replace-agent-with-draft"
  | "fresh-chat-session";
export type ClientSlashCommandExecution = "immediate" | "insert";

export interface ClientSlashCommand {
  name: string;
  aliases: readonly string[];
  description: string;
  descriptionKey:
    | "composer.clientCommands.archiveAgent"
    | "composer.clientCommands.freshDraft"
    | "composer.clientCommands.freshChatSession";
  argumentHint: string;
  kind: ClientSlashCommandKind;
  execution: ClientSlashCommandExecution;
}

export const CLIENT_SLASH_COMMANDS: readonly ClientSlashCommand[] = [
  {
    name: "exit",
    aliases: ["quit", "q"],
    description: "Archive the current agent",
    descriptionKey: "composer.clientCommands.archiveAgent",
    argumentHint: "",
    kind: "archive-agent",
    execution: "immediate",
  },
  {
    name: "clear",
    aliases: ["new"],
    description: "Archive this agent and start a fresh draft",
    descriptionKey: "composer.clientCommands.freshDraft",
    argumentHint: "",
    kind: "replace-agent-with-draft",
    execution: "immediate",
  },
];

/**
 * Clisbot Bots & Chats: a Chat's own commands. A Chat is not an agent tab, so it has none of the
 * tab's archive or draft commands; `/new` starts a fresh session for its Bots and keeps the
 * Chat's history (docs/features/bots-and-chats/README.md, D7).
 */
export const CONVERSATION_SLASH_COMMANDS: readonly ClientSlashCommand[] = [
  {
    name: "new",
    aliases: [],
    description: "Start a fresh session; this chat's history stays",
    descriptionKey: "composer.clientCommands.freshChatSession",
    argumentHint: "",
    kind: "fresh-chat-session",
    execution: "immediate",
  },
];

function indexCommands(commands: readonly ClientSlashCommand[]) {
  const byName = new Map<string, ClientSlashCommand>();
  for (const command of commands) {
    byName.set(command.name, command);
    for (const alias of command.aliases) byName.set(alias, command);
  }
  return byName;
}

const COMMANDS_BY_SET = new Map<readonly ClientSlashCommand[], Map<string, ClientSlashCommand>>([
  [CLIENT_SLASH_COMMANDS, indexCommands(CLIENT_SLASH_COMMANDS)],
  [CONVERSATION_SLASH_COMMANDS, indexCommands(CONVERSATION_SLASH_COMMANDS)],
]);

/** The command set a composer offers: an agent tab's, or a Chat's. */
export function clientSlashCommandsFor(
  target: "agent" | "conversation" | undefined,
): readonly ClientSlashCommand[] {
  return target === "conversation" ? CONVERSATION_SLASH_COMMANDS : CLIENT_SLASH_COMMANDS;
}

/**
 * The command a whole submitted text names, with nothing after it. Text with arguments
 * (`/new later`) is never a client command; it goes to the agent as typed.
 */
export function resolveClientSlashCommand(input: {
  text: string;
  hasAttachments: boolean;
  commands?: readonly ClientSlashCommand[];
}): ClientSlashCommand | null {
  if (input.hasAttachments) {
    return null;
  }

  const trimmed = input.text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const commandName = trimmed.slice(1);
  if (!commandName || /\s/.test(commandName)) {
    return null;
  }

  const commands = input.commands ?? CLIENT_SLASH_COMMANDS;
  const byName = COMMANDS_BY_SET.get(commands) ?? indexCommands(commands);
  return byName.get(commandName) ?? null;
}

export function buildDraftAgentSetup(agent: Agent): WorkspaceDraftTabSetup {
  return {
    provider: agent.provider,
    cwd: agent.cwd,
    modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    model: agent.model ?? agent.runtimeInfo?.model ?? null,
    thinkingOptionId: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? null,
    providerOptions: { ...agent.options },
  };
}
