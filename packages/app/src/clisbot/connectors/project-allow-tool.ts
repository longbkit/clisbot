import type { AgentToolGroup } from "@clisbot/protocol/connectors/agent-tools";
import {
  connectorAccessOf,
  connectorToolKindOf,
  type ConnectorGrant,
  type ConnectorTool,
  type ConnectorToolSelection,
} from "@clisbot/protocol/connectors/types";
import { projectGroupTools, saveGroupTools, type AgentToolDefaults } from "./agent-tools-model";
import { setAppAccess, setAppTools, setMcpServerTools } from "./model";

/**
 * Lets a Project use one more tool, from the session's Tools sheet: the person turning a tool on
 * there may change the Project anyway, so the switch does it for them after a confirm. Only that
 * tool is added; nothing else the Project allows changes.
 */

/** Why the Project does not give this tool of an app or server, or null when it does. */
export type ProjectToolRefusal = "not-picked" | "reads-only";

export function connectorToolRefusal(
  tool: ConnectorTool,
  entry: { tools?: ConnectorToolSelection; access?: string } | undefined,
): ProjectToolRefusal | null {
  const tools = entry?.tools ?? "all";
  if (tools !== "all" && !tools.includes(tool.name)) return "not-picked";
  const readsOnly = entry?.access !== undefined && connectorAccessOf(entry.access) === "read";
  if (readsOnly && connectorToolKindOf(tool.kind) !== "read") return "reads-only";
  return null;
}

/** `all` when the list covers every tool, so a later tool of the app comes with it. */
function selectionOf(names: readonly string[], all: readonly string[]): ConnectorToolSelection {
  return all.every((name) => names.includes(name)) ? "all" : [...new Set(names)].sort();
}

/**
 * Adds one tool to an app's grant. A change on a read-only app makes the app read and write but
 * keeps its other changing tools off, so only this one is added.
 */
export function allowAppTool(
  grant: ConnectorGrant | undefined,
  slug: string,
  tool: ConnectorTool,
  tools: readonly ConnectorTool[],
): ConnectorGrant {
  const app = grant?.apps?.[slug];
  if (!app) return { ...grant };
  const all = tools.map((entry) => entry.name);
  const picked = app.tools === "all" ? all : app.tools;
  if (connectorToolRefusal(tool, app) !== "reads-only") {
    return setAppTools(grant, slug, selectionOf([...picked, tool.name], all));
  }
  const reads = tools
    .filter((entry) => connectorToolKindOf(entry.kind) === "read" && picked.includes(entry.name))
    .map((entry) => entry.name);
  return setAppAccess(
    setAppTools(grant, slug, selectionOf([...reads, tool.name], all)),
    slug,
    "write",
  );
}

export function allowServerTool(
  grant: ConnectorGrant | undefined,
  name: string,
  tool: string,
  all: readonly string[],
): ConnectorGrant {
  const server = grant?.mcpServers?.[name];
  if (!server) return { ...grant };
  const picked = server.tools === "all" ? all : server.tools;
  return setMcpServerTools(grant, name, selectionOf([...picked, tool], all));
}

export function allowGroupTool(
  grant: ConnectorGrant | undefined,
  group: AgentToolGroup,
  tool: string,
  defaults: AgentToolDefaults | undefined,
): ConnectorGrant {
  return saveGroupTools(
    grant,
    group,
    [...projectGroupTools(grant, group, defaults), tool],
    defaults,
  );
}
