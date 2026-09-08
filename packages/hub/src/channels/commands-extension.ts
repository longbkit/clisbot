import type { ChannelAccountKey } from "../db/channel-access.js";
import type { DaemonConnection } from "./daemon/client.js";
import { isReservedChannelCommand, normalizeChannelCommandText } from "./commands.js";

export interface DynamicCommandStore {
  listCommands(key: ChannelAccountKey): Promise<{ name: string; prompt: string }[]>;
  findCommand(
    key: ChannelAccountKey,
    name: string,
  ): Promise<{ name: string; prompt: string } | undefined>;
  setCommand(
    key: ChannelAccountKey,
    command: { name: string; prompt: string; updatedBy: string },
  ): Promise<unknown>;
  removeCommand(key: ChannelAccountKey, name: string): Promise<boolean>;
}
export interface ExtensionCommandInput {
  command: { name: "skill" | "command"; value?: string };
  daemon: Pick<DaemonConnection, "listCommands">;
  agentId?: string;
  store: DynamicCommandStore;
  key: ChannelAccountKey;
  senderIdentity: string;
  canManageCommands: boolean;
}
export interface ExtensionCommandResult {
  text?: string;
  prompt?: string;
}

/** The returned prompt goes straight to the agent; it must never re-enter the platform parser. */
export async function runExtensionCommand(
  input: ExtensionCommandInput,
): Promise<ExtensionCommandResult> {
  const value = input.command.value?.trim() ?? "";
  const management = /^(add|remove)(?:\s+([\s\S]*))?$/iu.exec(value);
  if (input.command.name === "command" && management)
    return manageCommand(input, management[1]!.toLowerCase(), management[2] ?? "");
  const listing = value === "" || /^list$/iu.test(value) || /^search(?:\s|$)/iu.test(value);
  const dynamic = input.command.name === "command" ? await input.store.listCommands(input.key) : [];
  const native =
    input.agentId === undefined
      ? []
      : (await input.daemon.listCommands(input.agentId)).filter(
          (command) => input.command.name === "command" || command.kind === "skill",
        );
  if (listing) {
    const query = /^search\s+([\s\S]+)$/iu.exec(value)?.[1]?.toLowerCase() ?? "";
    const options = [
      ...dynamic.map((command) => `${command.name} (account command)`),
      ...native
        .filter((command) => !dynamic.some((entry) => entry.name === command.name))
        .map((command) => `${command.name} — ${command.description}`),
    ].filter((line) => line.toLowerCase().includes(query));
    return { text: `Available ${input.command.name}s: ${options.join("\n") || "none"}.` };
  }
  const invocation = /^([^\s]+)(?:\s+([\s\S]*))?$/u.exec(value)!;
  const name = invocation[1]!.replace(/^\//u, "").toLowerCase();
  const args = invocation[2] ?? "";
  const stored = dynamic.find((command) => command.name === name);
  if (stored) return { prompt: appendArguments(stored.prompt, args) };
  const command = native.find((entry) => entry.name.replace(/^\//u, "").toLowerCase() === name);
  if (!command) return { text: `Unknown ${input.command.name}. Use /${input.command.name} list.` };
  return { prompt: `/${command.name.replace(/^\//u, "")}${args ? ` ${args}` : ""}` };
}

async function manageCommand(
  input: ExtensionCommandInput,
  action: string,
  rest: string,
): Promise<ExtensionCommandResult> {
  if (!input.canManageCommands)
    return { text: "Managing account commands requires approval.config." };
  const parts = /^([^\s]+)(?:\s+([\s\S]*))?$/u.exec(rest.trim());
  const name = parts?.[1]?.replace(/^\//u, "").toLowerCase();
  if (!name || !/^[a-z][a-z0-9_-]*$/u.test(name))
    return {
      text: "Use a command name containing letters, digits, underscores or hyphens, starting with a letter.",
    };
  if (isReservedChannelCommand(name)) return { text: `/${name} is reserved by the platform.` };
  if (action === "remove") {
    if (parts?.[2]) return { text: "Usage: /command remove <name>" };
    return {
      text: (await input.store.removeCommand(input.key, name))
        ? `Removed /${name}.`
        : `No account command /${name}.`,
    };
  }
  const prompt = parts?.[2]?.trim();
  if (!prompt) return { text: "Usage: /command add <name> <prompt>" };
  await input.store.setCommand(input.key, { name, prompt, updatedBy: input.senderIdentity });
  return { text: `Saved /${name} for this channel account.` };
}

export async function expandDynamicCommand(
  store: Pick<DynamicCommandStore, "findCommand">,
  key: ChannelAccountKey,
  text: string,
): Promise<string | undefined> {
  const invocation = /^[/\\]([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/iu.exec(
    normalizeChannelCommandText(text, true).trim(),
  );
  if (!invocation || isReservedChannelCommand(invocation[1]!)) return undefined;
  const command = await store.findCommand(key, invocation[1]!.toLowerCase());
  return command ? appendArguments(command.prompt, invocation[2] ?? "") : undefined;
}
function appendArguments(prompt: string, args: string): string {
  return args ? `${prompt}\n\n${args}` : prompt;
}
