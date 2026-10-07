import {
  connectorAccessOf,
  connectorEnabledApps,
  connectorToolOffKey,
  type ConnectorGrant,
} from "@clisbot/protocol/connectors/types";
import { DEFAULT_PROTOCOL_VERSION, type JsonRpcFrame } from "./connector-upstream.js";
import { isOfferedComposioTool } from "./connector-verdict.js";
import { CLISBOT_MCP_IMPLEMENTATION, isRecord } from "./connector-json.js";

/**
 * The JSON-RPC frames the Connector relay answers with, and what a target offers a session
 * (docs/features/connectors/README.md, "Runtime"). Pure functions; `connector-relay.ts` uses them.
 */

export type RelayTarget = { kind: "composio" } | { kind: "server"; name: string };

/** The methods the relay serves. It answers `initialize` with tools only, so clients ask for no others. */
export const RELAYED_METHODS = new Set(["initialize", "ping", "tools/list", "tools/call"]);

export function jsonRpcId(frame: unknown): string | number | null {
  if (isRecord(frame) && (typeof frame.id === "string" || typeof frame.id === "number")) {
    return frame.id;
  }
  return null;
}

export function textResult(frame: unknown, text: string): JsonRpcFrame {
  return { jsonrpc: "2.0", id: jsonRpcId(frame), result: { content: [{ type: "text", text }] } };
}

export function refusalResult(frame: unknown, message: string): JsonRpcFrame {
  return {
    jsonrpc: "2.0",
    id: jsonRpcId(frame),
    result: { content: [{ type: "text", text: message }], isError: true },
  };
}

export function rpcError(frame: unknown, code: number, message: string): JsonRpcFrame {
  return { jsonrpc: "2.0", id: jsonRpcId(frame), error: { code, message } };
}

/**
 * A failure as the agent should see it: a failed tool call is a tool result it can read and
 * retry, anything else a JSON-RPC error. Both travel as HTTP 200, so an upstream's 401 never
 * reaches the agent's MCP client, which would start an OAuth sign-in against the daemon.
 */
export function failure(frame: JsonRpcFrame, message: string): JsonRpcFrame {
  if (frame.method === "tools/call") return refusalResult(frame, message);
  return rpcError(frame, -32603, message);
}

/** The relay's own answer to `initialize`; the upstream's session is opened separately. */
export function initializeResult(frame: JsonRpcFrame, instructions: string): JsonRpcFrame {
  const requested = isRecord(frame.params) ? frame.params.protocolVersion : undefined;
  return {
    jsonrpc: "2.0",
    id: jsonRpcId(frame),
    result: {
      protocolVersion:
        typeof requested === "string" && requested ? requested : DEFAULT_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: CLISBOT_MCP_IMPLEMENTATION,
      instructions,
    },
  };
}

/**
 * Whether the session may reach this target at all: Composio while any app is on, a server while
 * it is granted and on. Nothing reaches an upstream for a target that is not open.
 */
export function targetOpen(target: RelayTarget, grant: ConnectorGrant | undefined): boolean {
  if (target.kind === "composio") return connectorEnabledApps(grant).length > 0;
  const server = grant?.mcpServers?.[target.name];
  return server !== undefined && server.enabled !== false;
}

/** Which tools a `tools/list` answer may show for this target and grant. */
export function toolFilter(
  target: RelayTarget,
  grant: ConnectorGrant | undefined,
  sessionAllows: ReadonlySet<string> = new Set(),
): (name: string) => boolean {
  if (target.kind === "composio") return isOfferedComposioTool;
  const server = grant?.mcpServers?.[target.name];
  const tools = server?.enabled === false ? undefined : server?.tools;
  if (!tools) return () => false;
  if (tools === "all") return () => true;
  const allowed = (name: string) =>
    sessionAllows.has(connectorToolOffKey({ mcpServer: target.name }, name));
  return (name) => tools.includes(name) || allowed(name);
}

/**
 * What the agent reads first about this server. Agents with their own app integrations
 * (Codex's `codex_apps`) otherwise reach for those, and the person's Connectors go unused.
 */
export function connectorInstructions(
  target: RelayTarget,
  grant: ConnectorGrant | undefined,
): string {
  if (target.kind === "server") {
    return `MCP server "${target.name}", added to this Project as a Clisbot Connector by the person you work for.`;
  }
  const apps = connectorEnabledApps(grant).map((slug) => {
    const write = connectorAccessOf(grant?.apps?.[slug]?.access) === "write";
    return `${slug} (${write ? "read and write" : "read only"})`;
  });
  return [
    "These are this session's Clisbot Connectors: apps the person connected through Composio and granted to you.",
    `Apps you may use: ${apps.join(", ") || "none"}.`,
    "Prefer these tools over any other integration for these apps. Find a tool with COMPOSIO_SEARCH_TOOLS, then run it with COMPOSIO_MULTI_EXECUTE_TOOL.",
    'When an app has several accounts, set "account" on each entry of COMPOSIO_MULTI_EXECUTE_TOOL to the account\'s name; when this session may use only one, Clisbot sets it for you.',
    "Tools that send something to someone may wait for the person's approval.",
    "If an app has no connected account, call COMPOSIO_MANAGE_CONNECTIONS with its toolkit: Clisbot shows the person a connect card and answers once it is connected. Do not send the person sign-in links yourself.",
  ].join(" ");
}
