import type { ToolCallDetail } from "@clisbot/protocol/agent-types";
import { getClisbotToolLeafName } from "@clisbot/protocol/tool-name-normalization";

// `clisbot heartbeat create …` run as a command (any CLI name, such as `clisbot-dev`, or the
// built CLI), not the words inside a search like `rg "heartbeat create"`.
const SHELL_HEARTBEAT_CREATE =
  /(?:^|[;&|(]\s*|\s)(?:\S*\/)?(?:clisbot[\w-]*|cli\/dist\/index\.js)\s+heartbeat\s+create\b/;

/**
 * Whether a timeline tool call creates a heartbeat, which renders as a card: the daemon's
 * `create_heartbeat` tool, or the CLI's `heartbeat create` run in a shell.
 */
export function isCreateHeartbeatToolCall(name: string, detail?: ToolCallDetail): boolean {
  if (getClisbotToolLeafName(name) === "create_heartbeat") return true;
  return detail?.type === "shell" && SHELL_HEARTBEAT_CREATE.test(detail.command);
}

/** The heartbeat a completed tool call created, or null when it made none. */
export function heartbeatIdFromToolCall(name: string, detail: ToolCallDetail): string | null {
  if (!isCreateHeartbeatToolCall(name, detail)) return null;
  if (detail.type === "shell") {
    return heartbeatIdFromOutput(detail.output ?? "") ?? idFromTable(detail.output ?? "");
  }
  return detail.type === "unknown" ? heartbeatIdFromOutput(detail.output) : null;
}

/** Without `--json` the CLI prints a table whose first column is the id. */
function idFromTable(output: string): string | null {
  return /^\s*([0-9a-f]{8})\s/m.exec(output)?.[1] ?? null;
}

/** The schedule id in a `create_heartbeat` result, whatever shape the provider handed back. */
export function heartbeatIdFromOutput(output: unknown): string | null {
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.id === "string") return record.id;
    // Claude wraps the tool result as `{ output: … }`; MCP clients as `structuredContent`.
    if (record.output) return heartbeatIdFromOutput(record.output);
    if (record.structuredContent) return heartbeatIdFromOutput(record.structuredContent);
    if (Array.isArray(record.content)) return heartbeatIdFromOutput(JSON.stringify(record.content));
  }
  if (typeof output === "string") {
    // Also matches an id inside JSON that was itself stringified (escaped quotes).
    const match = /\\?"id\\?"\s*:\s*\\?"([^"\\]+)/.exec(output);
    return match?.[1] ?? null;
  }
  return null;
}
