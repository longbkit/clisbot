import {
  AGENT_TOOL_GROUPS,
  BROWSER_TOOL_GROUP,
  agentToolGroupOffKey,
  agentToolOffKey,
  type AgentToolGroup,
} from "@clisbot/protocol/connectors/agent-tools";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import type { AgentToolDefaults } from "./project-grants";
import type { SessionToolSet } from "./session-connectors";

/**
 * A Project's choice for the daemon's own tools (docs/features/connectors/README.md, "Agent
 * tools"): follow the Host, or turn them on or off for its sessions, and which tools of each group.
 * The browser is one of the groups, with its own Host default. Each edit changes only what it
 * names, like the Connector edits in `model.ts`.
 */

export type ToolsChoice = "host" | "on" | "off";

export const TOOL_GROUPS = AGENT_TOOL_GROUPS;

export function isBrowserGroup(group: AgentToolGroup): boolean {
  return group.id === BROWSER_TOOL_GROUP;
}

export function toolsChoiceOf(value: boolean | undefined): ToolsChoice {
  if (value === undefined) return "host";
  return value ? "on" : "off";
}

export function setClisbotToolsChoice(
  grant: ConnectorGrant | undefined,
  choice: ToolsChoice,
): ConnectorGrant {
  const { enabled: _previous, ...rest } = grant?.agentTools ?? {};
  const agentTools = choice === "host" ? rest : { ...rest, enabled: choice === "on" };
  return withAgentTools(grant, agentTools);
}

/** Whether the Project's sessions get these tools, by its choice or else the Host's. */
export function toolsOn(choice: boolean | undefined, hostDefault: boolean | undefined): boolean {
  return choice ?? hostDefault ?? false;
}

export function disabledToolsOf(grant: ConnectorGrant | undefined): ReadonlySet<string> {
  return new Set(grant?.agentTools?.disabledTools ?? []);
}

/** The group's tools the Project keeps on, by its tool list alone. */
export function enabledToolsOf(group: AgentToolGroup, disabled: ReadonlySet<string>): string[] {
  return group.tools.map((tool) => tool.name).filter((name) => !disabled.has(name));
}

/** The group's tools the Project's sessions get: none from a browser that is off. */
export function projectGroupTools(
  grant: ConnectorGrant | undefined,
  group: AgentToolGroup,
  defaults: AgentToolDefaults | undefined,
): string[] {
  if (isBrowserGroup(group) && !toolsOn(grant?.browserTools, defaults?.browserTools)) return [];
  return enabledToolsOf(group, disabledToolsOf(grant));
}

/** Keeps exactly `enabled` of the group's tools on; other groups' choices stay as they are. */
export function setGroupTools(
  grant: ConnectorGrant | undefined,
  group: AgentToolGroup,
  enabled: readonly string[],
): ConnectorGrant {
  const inGroup = new Set(group.tools.map((tool) => tool.name));
  const others = (grant?.agentTools?.disabledTools ?? []).filter((name) => !inGroup.has(name));
  const off = group.tools.map((tool) => tool.name).filter((name) => !enabled.includes(name));
  const disabledTools = [...others, ...off];
  const { disabledTools: _previous, ...rest } = grant?.agentTools ?? {};
  return withAgentTools(grant, disabledTools.length > 0 ? { ...rest, disabledTools } : rest);
}

/**
 * The browser follows the Host's "Browser tools" until the Project's switch differs from it; a
 * switch back to the Host's value follows the Host again.
 */
function setBrowserOn(
  grant: ConnectorGrant | undefined,
  on: boolean,
  hostDefault: boolean | undefined,
): ConnectorGrant {
  const { browserTools: _previous, ...rest } = grant ?? {};
  return on === (hostDefault ?? false) ? rest : { ...rest, browserTools: on };
}

/**
 * Saves a group's tool list. For the browser, picking none turns it off and keeps its list, and
 * picking any turns it on.
 */
export function saveGroupTools(
  grant: ConnectorGrant | undefined,
  group: AgentToolGroup,
  enabled: readonly string[],
  defaults: AgentToolDefaults | undefined,
): ConnectorGrant {
  if (!isBrowserGroup(group)) return setGroupTools(grant, group, enabled);
  if (enabled.length === 0) return setBrowserOn(grant, false, defaults?.browserTools);
  return setBrowserOn(setGroupTools(grant, group, enabled), true, defaults?.browserTools);
}

/** A group's switch: all its tools on, or none. */
export function setGroupOn(
  grant: ConnectorGrant | undefined,
  group: AgentToolGroup,
  on: boolean,
  defaults: AgentToolDefaults | undefined,
): ConnectorGrant {
  return saveGroupTools(grant, group, on ? group.tools.map((tool) => tool.name) : [], defaults);
}

/** "All 10 tools", "3 of 10 tools", "Off". */
export function toolCountSummary(on: number, total: number): string {
  if (on === 0) return "Off";
  return on === total ? `All ${on} tools` : `${on} of ${total} tools`;
}

export function groupSummary(
  grant: ConnectorGrant | undefined,
  group: AgentToolGroup,
  defaults: AgentToolDefaults | undefined,
): string {
  const summary = toolCountSummary(
    projectGroupTools(grant, group, defaults).length,
    group.tools.length,
  );
  return isBrowserGroup(group) && grant?.browserTools === undefined
    ? `${summary} · Host default`
    : summary;
}

export function hostDefaultLabel(value: boolean | undefined): string {
  if (value === undefined) return "Host default";
  return value ? "Host default: on" : "Host default: off";
}

function withAgentTools(
  grant: ConnectorGrant | undefined,
  agentTools: NonNullable<ConnectorGrant["agentTools"]>,
): ConnectorGrant {
  const { agentTools: _previous, ...rest } = grant ?? {};
  return Object.keys(agentTools).length > 0 ? { ...rest, agentTools } : rest;
}

/** A group as a session tool set: its key, its tools' keys, what the Project gives. */
export function groupToolSet(
  group: AgentToolGroup,
  projectTools: readonly string[],
): SessionToolSet {
  return { wholeKey: agentToolGroupOffKey(group.id), keyOf: agentToolOffKey, given: projectTools };
}

export type { AgentToolDefaults };
