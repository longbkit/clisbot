import type { AgentToolGroup } from "@clisbot/protocol/connectors/agent-tools";
import {
  connectorEnabledApps,
  connectorEnabledServers,
  connectorOffKey,
  connectorToolOffKey,
  type ConnectorGrant,
} from "@clisbot/protocol/connectors/types";
import {
  TOOL_GROUPS,
  groupToolSet,
  projectGroupTools,
  toolsOn,
  type AgentToolDefaults,
} from "./agent-tools-model";
import { sessionKeptTools, type SessionToolSet } from "./session-connectors";
import { withAllows } from "./session-allows";

/**
 * What one session may use from its Project (docs/features/connectors/README.md, "Per session"):
 * the Clisbot tool groups the Project gives, with their tools, then its Connectors that are on,
 * whose tools are listed when a page opens them.
 * The session can only take away from this.
 */

export interface SessionToolGroup {
  group: AgentToolGroup;
  /** The group's tools the Project gives its sessions, and their keys. */
  set: SessionToolSet;
}

export interface SessionConnector {
  /** The key in the session's off list. */
  key: string;
  target: { kind: "app"; slug: string } | { kind: "mcp"; name: string };
  /** The key of one of its tools. */
  toolKey(tool: string): string;
}

export interface SessionTools {
  groups: SessionToolGroup[];
  connectors: SessionConnector[];
}

export function sessionTools(
  grant: ConnectorGrant | undefined,
  defaults: AgentToolDefaults | undefined,
): SessionTools {
  const clisbotOn = toolsOn(grant?.agentTools?.enabled, defaults?.agentTools);
  const groups = clisbotOn
    ? TOOL_GROUPS.map((group) => ({
        group,
        set: groupToolSet(group, projectGroupTools(grant, group, defaults)),
      }))
    : [];
  const connectors: SessionConnector[] = [
    ...connectorEnabledApps(grant).map((slug) => ({
      key: connectorOffKey({ app: slug }),
      target: { kind: "app" as const, slug },
      toolKey: (tool: string) => connectorToolOffKey({ app: slug }, tool),
    })),
    ...connectorEnabledServers(grant).map((name) => ({
      key: connectorOffKey({ mcpServer: name }),
      target: { kind: "mcp" as const, name },
      toolKey: (tool: string) => connectorToolOffKey({ mcpServer: name }, tool),
    })),
  ];
  return { groups, connectors };
}

/**
 * How many groups and Connectors the session keeps; a group counts while any of its tools is on,
 * the ones it may use beyond the Project included.
 */
export function sessionOnCount(
  tools: SessionTools,
  off: ReadonlySet<string>,
  allows: ReadonlySet<string> = new Set(),
): number {
  const groups = tools.groups.filter((entry) => {
    const names = entry.group.tools.map((tool) => tool.name);
    return sessionKeptTools(withAllows(entry.set, names, allows), off).length > 0;
  }).length;
  return groups + tools.connectors.filter((entry) => !off.has(entry.key)).length;
}
