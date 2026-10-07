import {
  AGENT_TOOL_GROUPS,
  BROWSER_TOOL_GROUP,
  agentToolGroupOffKey,
  agentToolOffKey,
} from "@clisbot/protocol/connectors/agent-tools";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import type { ProviderClisbotToolsPolicy } from "@clisbot/protocol/provider-config";
import type { ConnectorProjectDirectory } from "./connector-runtime.js";

/**
 * Which of the daemon's own tools one agent may call now (docs/features/connectors/README.md,
 * "Agent tools"). The launch decided whether the agent has them at all (the Project's choice
 * over the Host's "Inject Clisbot tools"); each call then takes away what the Project disabled
 * and the groups and tools its session turned off, and gives back what the daemon allows that one
 * session beyond its Project (`sessionAllows`, which the agent cannot write). A Project switched to Off applies from the next call.
 * The browser tools follow the Project's choice, else the Host's "Browser tools".
 */

export interface AgentToolAccess {
  policy: ProviderClisbotToolsPolicy | undefined;
  browserTools: boolean;
}

export async function agentToolAccess(input: {
  agentId: string;
  /** What the Host and the launch give: the agent's launch policy and the Host's browser switch. */
  base: AgentToolAccess;
  projects: ConnectorProjectDirectory;
  grants(): Promise<Record<string, ConnectorGrant>>;
  /** Tools this one session may use beyond its Project's choice (`tool:<name>`). */
  sessionAllows: ReadonlySet<string>;
}): Promise<AgentToolAccess> {
  const grant = await projectGrant(input);
  if (grant?.agentTools?.enabled === false)
    return { policy: { enabled: false }, browserTools: false };
  const allowed = (name: string) => input.sessionAllows.has(agentToolOffKey(name));
  const off = await input.projects.offList(input.agentId);
  const browser = browserFor(grant?.browserTools ?? input.base.browserTools, allowed);
  const disabled = new Set([
    ...(input.base.policy?.disabledTools ?? []),
    ...(grant?.agentTools?.disabledTools ?? []).filter((name) => !allowed(name)),
    ...browser.disabled,
    ...sessionOffTools(off),
  ]);
  return {
    policy:
      disabled.size > 0
        ? { ...input.base.policy, disabledTools: [...disabled] }
        : input.base.policy,
    browserTools: browser.on,
  };
}

/**
 * A browser the Project leaves off is on for a session allowed some of its tools, with only
 * those tools.
 */
function browserFor(projectOn: boolean, allowed: (name: string) => boolean) {
  if (projectOn) return { on: true, disabled: [] };
  const tools = AGENT_TOOL_GROUPS.find((group) => group.id === BROWSER_TOOL_GROUP)?.tools ?? [];
  const names = tools.map((tool) => tool.name);
  if (!names.some(allowed)) return { on: false, disabled: [] };
  return { on: true, disabled: names.filter((name) => !allowed(name)) };
}

/** The tools a session's off list names, one by one or by their group. */
function sessionOffTools(off: ReadonlySet<string>): string[] {
  return AGENT_TOOL_GROUPS.flatMap((group) => {
    const groupOff = off.has(agentToolGroupOffKey(group.id));
    return group.tools
      .map((tool) => tool.name)
      .filter((name) => groupOff || off.has(agentToolOffKey(name)));
  });
}

async function projectGrant(input: {
  agentId: string;
  projects: ConnectorProjectDirectory;
  grants(): Promise<Record<string, ConnectorGrant>>;
}): Promise<ConnectorGrant | undefined> {
  const cwd = input.projects.agentCwd(input.agentId);
  const project = cwd ? await input.projects.projectForCwd(cwd) : null;
  return project ? (await input.grants())[project.projectId] : undefined;
}
