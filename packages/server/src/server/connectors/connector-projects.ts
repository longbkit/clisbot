import { getChatIdFromLabels } from "@clisbot/protocol/bots/labels";
import { readConnectorsOff } from "@clisbot/protocol/connectors/types";
import { chatAllowsKey } from "@clisbot/protocol/connectors/rpc-schemas";
import type { BotService } from "../bots/index.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../workspace-registry.js";
import { createPathEquivalenceMatcher } from "../../utils/path.js";
import type { ConnectorProject, ConnectorProjectDirectory } from "./connector-runtime.js";

/**
 * Which Project an agent session belongs to (docs/features/connectors/README.md, "Runtime"): the
 * active Project one of whose Workspaces runs in the session's folder, worktrees included. A
 * Project that is archived, or is the home of an archived Bot, gets no Connectors.
 */
export function createConnectorProjectDirectory(deps: {
  projectRegistry: ProjectRegistry;
  workspaceRegistry: WorkspaceRegistry;
  botService: BotService | null;
  agentLabels(agentId: string): Record<string, string> | undefined;
  agentCwd(agentId: string): string | undefined;
  agentState(agentId: string): "active" | "closed" | "gone";
  /** A Chat's tools off list, for the Bots' sessions in it; absent without Chats. */
  chatToolsOff?(chatId: string): Promise<readonly string[]>;
}): ConnectorProjectDirectory {
  const archivedBotProjects = trackArchivedBotProjects(deps.botService);

  async function active(projectId: string): Promise<ConnectorProject | null> {
    const record = await deps.projectRegistry.get(projectId);
    if (!record || record.archivedAt !== null) return null;
    return (await archivedBotProjects()).has(projectId)
      ? null
      : { projectId, rootPath: record.rootPath };
  }

  return {
    project: active,
    async projectForCwd(cwd) {
      const sameFolder = createPathEquivalenceMatcher(cwd);
      const workspaces = await deps.workspaceRegistry.list();
      const match = workspaces.find(
        (workspace) => workspace.archivedAt === null && sameFolder(workspace.cwd),
      );
      return match ? active(match.projectId) : null;
    },
    agentLabels: deps.agentLabels,
    async offList(agentId) {
      const labels = deps.agentLabels(agentId);
      const off = readConnectorsOff(labels);
      const chatId = getChatIdFromLabels(labels);
      if (chatId && deps.chatToolsOff) {
        for (const key of await deps.chatToolsOff(chatId)) off.add(key);
      }
      return off;
    },
    allowOwners(agentId) {
      const chatId = getChatIdFromLabels(deps.agentLabels(agentId));
      return chatId ? [agentId, chatAllowsKey(chatId)] : [agentId];
    },
    agentCwd: deps.agentCwd,
    agentState: deps.agentState,
  };
}

/**
 * The Projects of archived Bots, read once and kept current from the Bot service's changes, so a
 * tool call does not read every Bot record.
 */
function trackArchivedBotProjects(
  botService: BotService | null,
): () => Promise<ReadonlySet<string>> {
  const archived = new Map<string, string>();
  /** Bots a change event already told about; the first full read never overrides them. */
  const seen = new Set<string>();
  let loaded: Promise<void> | null = null;
  botService?.subscribe((event) => {
    seen.add(event.kind === "remove" ? event.botId : event.bot.id);
    if (event.kind === "remove") archived.delete(event.botId);
    else if (event.bot.archivedAt !== null) archived.set(event.bot.id, event.bot.projectId);
    else archived.delete(event.bot.id);
  });
  async function load(): Promise<void> {
    const bots = (await botService?.list(true)) ?? [];
    for (const bot of bots) {
      if (bot.archivedAt !== null && !seen.has(bot.id)) archived.set(bot.id, bot.projectId);
    }
  }
  return async () => {
    // A failed read is not kept: the next call reads again.
    loaded ??= load().catch((error: unknown) => {
      loaded = null;
      throw error;
    });
    await loaded;
    return new Set(archived.values());
  };
}
