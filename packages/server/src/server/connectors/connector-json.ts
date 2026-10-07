/**
 * Small JSON and MCP pieces every Connectors module shares (docs/features/connectors/README.md).
 * A leaf module: it imports nothing from the Connectors code, so anything may import it.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The MCP protocol version Clisbot speaks when it opens a session itself. */
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

/** How Clisbot names itself to an MCP server, and to an agent as one. */
export const CLISBOT_MCP_IMPLEMENTATION = { name: "clisbot-connectors", version: "1" } as const;

/**
 * The reason in an error body: `error.message`, `error` as text, or `message`. Composio and MCP
 * servers use all three.
 */
export function errorTextOf(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const { error, message } = body;
  if (isRecord(error) && typeof error.message === "string" && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return typeof message === "string" && message ? message : undefined;
}
