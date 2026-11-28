import type {
  ClisbotApi,
  ClisbotAgent,
  ClisbotAgentHandle,
  ClisbotWorkspace,
  ClisbotWorkspaceHandle,
  ClisbotWorkspaceCreateOptions,
} from "@clisbot/client";
import type { ClisbotTerminal, ClisbotTerminalHandle } from "@clisbot/client";
import type { PluginProjectSnapshot } from "../contracts.js";
import type { AgentRef, ProjectRef, TerminalRef, WorkspaceRef } from "../refs.js";
import type { PluginSidebarViewProps } from "./contracts.js";

export interface PluginProjectHandle {
  readonly ref: ProjectRef;
  open(): void;
  createWorkspace(
    input?: Omit<ClisbotWorkspaceCreateOptions, "source"> & {
      source?: ClisbotWorkspaceCreateOptions["source"];
    },
  ): Promise<ClisbotWorkspaceHandle>;
}
export interface PluginTerminalHandle extends ClisbotTerminalHandle {
  focus(): void;
}
export interface PluginClisbotApi extends ClisbotApi {
  workspaces: Omit<ClisbotApi["workspaces"], "ref"> & {
    ref(workspace: string | ClisbotWorkspace | WorkspaceRef): ClisbotWorkspaceHandle;
  };
  agents: Omit<ClisbotApi["agents"], "ref"> & {
    ref(agent: string | ClisbotAgent | AgentRef): ClisbotAgentHandle;
  };
  projects: ClisbotApi["projects"] & { ref(project: ProjectRef): PluginProjectHandle };
  terminals: Omit<ClisbotApi["terminals"], "ref"> & {
    ref(terminal: TerminalRef): PluginTerminalHandle;
    ref(terminal: string | ClisbotTerminal): ClisbotTerminalHandle;
  };
}

/** Host adapter; the installation retains its single API identity across every surface. */
export function createPluginReferenceApi(input: {
  clisbot: ClisbotApi;
  resolveHost(hostId: string): ClisbotApi;
  readProject(ref: ProjectRef): PluginProjectSnapshot | null;
  navigation: PluginSidebarViewProps["navigation"];
}): PluginClisbotApi {
  const { clisbot } = input;
  const workspaceRef = clisbot.workspaces.ref;
  const agentRef = clisbot.agents.ref;
  const terminalRef = clisbot.terminals.ref;
  function refWorkspace(workspace: string | ClisbotWorkspace | WorkspaceRef) {
    if (typeof workspace !== "string" && "hostId" in workspace)
      return input.resolveHost(workspace.hostId).workspaces.ref(workspace.id);
    return workspaceRef(workspace);
  }
  function refAgent(agent: string | ClisbotAgent | AgentRef) {
    if (typeof agent !== "string" && "hostId" in agent)
      return input.resolveHost(agent.hostId).agents.ref(agent.id);
    return agentRef(agent);
  }
  function terminal(ref: TerminalRef): PluginTerminalHandle;
  function terminal(ref: string | ClisbotTerminal): ClisbotTerminalHandle;
  function terminal(ref: TerminalRef | string | ClisbotTerminal): ClisbotTerminalHandle {
    if (typeof ref !== "string" && "hostId" in ref) {
      const handle = input.resolveHost(ref.hostId).terminals.ref(ref.id);
      return Object.assign(handle, { focus: () => input.navigation.openTerminal(ref) });
    }
    return terminalRef(ref);
  }
  function project(ref: ProjectRef): PluginProjectHandle {
    return {
      ref,
      open: () => input.navigation.openProject(ref),
      async createWorkspace(options = {}) {
        const snapshot = input.readProject(ref);
        if (!snapshot) throw new Error("Project is no longer available");
        const source = options.source ?? { kind: "directory", path: snapshot.rootPath };
        return input.resolveHost(ref.hostId).workspaces.create({ ...options, source });
      },
    };
  }
  return Object.assign(clisbot, {
    workspaces: Object.assign(clisbot.workspaces, { ref: refWorkspace }),
    agents: Object.assign(clisbot.agents, { ref: refAgent }),
    projects: Object.assign(clisbot.projects, { ref: project }),
    terminals: Object.assign(clisbot.terminals, { ref: terminal }),
  });
}
