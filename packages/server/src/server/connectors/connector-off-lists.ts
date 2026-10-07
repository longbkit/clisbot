import {
  CONNECTORS_OFF_LABEL,
  connectorOffKey,
  formatConnectorsOff,
  readConnectorsOff,
} from "@clisbot/protocol/connectors/types";

/**
 * Keeps sessions' off lists (`clisbot.connectors-off`), Chats' lists and session allows naming the
 * right MCP server. They hold `mcp:<name>` and `mcp:<name>/<tool>`, so a renamed server would come
 * back on for a session that had it off, and a removed one would leave its name to a later server
 * of the same name.
 */

/** The keys with the server renamed (or its keys dropped, `to: null`); null when none named it. */
export function renameServerKeys(
  keys: Iterable<string>,
  change: { from: string; to: string | null },
): string[] | null {
  const whole = connectorOffKey({ mcpServer: change.from });
  const prefix = `${whole}/`;
  let changed = false;
  const next: string[] = [];
  for (const key of keys) {
    const tool = key.startsWith(prefix) ? key.slice(prefix.length) : null;
    if (key !== whole && tool === null) {
      next.push(key);
      continue;
    }
    changed = true;
    if (change.to === null) continue;
    const renamed = connectorOffKey({ mcpServer: change.to });
    next.push(tool === null ? renamed : `${renamed}/${tool}`);
  }
  return changed ? [...new Set(next)] : null;
}
export interface OffListAgents {
  listAgents(): { id: string; labels: Record<string, string> }[];
  setLabels(agentId: string, labels: Record<string, string>): Promise<void>;
}

/** `to: null` drops the server from every list (it was removed). */
export async function renameServerInOffLists(
  agents: OffListAgents,
  change: { from: string; to: string | null },
): Promise<void> {
  if (change.from === change.to) return;
  const writes = agents.listAgents().flatMap((agent) => {
    const off = renameServerKeys(readConnectorsOff(agent.labels), change);
    if (!off) return [];
    return [agents.setLabels(agent.id, { [CONNECTORS_OFF_LABEL]: formatConnectorsOff(off) })];
  });
  // One agent that cannot be written does not stop the others.
  const failed = (await Promise.allSettled(writes)).find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) throw failed.reason;
}

/** The Chats whose tools off lists name servers: read them, and write one back. */
export interface ChatOffLists {
  list(): Promise<{ chatId: string; off: readonly string[] }[]>;
  set(chatId: string, off: string[]): Promise<void>;
}

/** The same rename for every Chat's list; an archived Chat that cannot be written is skipped. */
export async function renameServerInChatLists(
  chats: ChatOffLists,
  change: { from: string; to: string | null },
): Promise<void> {
  if (change.from === change.to) return;
  const writes = (await chats.list()).flatMap(({ chatId, off }) => {
    const renamed = renameServerKeys(off, change);
    return renamed ? [chats.set(chatId, renamed)] : [];
  });
  await Promise.allSettled(writes);
}
