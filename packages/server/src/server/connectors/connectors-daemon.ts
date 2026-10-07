import express from "express";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import type { BotService } from "../bots/index.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../workspace-registry.js";
import { createConnectorProjectDirectory } from "./connector-projects.js";
import { ConnectorRelay } from "./connector-relay.js";
import { ConnectorRuntime, CONNECTORS_RELAY_ROUTE } from "./connector-runtime.js";
import { createConnectorServiceFromConfig, type ConnectorService } from "./connector-service.js";
import { agentToolAccess, type AgentToolAccess } from "./connector-agent-tools.js";
import {
  renameServerInChatLists,
  renameServerInOffLists,
  type ChatOffLists,
} from "./connector-off-lists.js";
import { createStdioServers } from "./connector-stdio.js";
import type { ConnectorsConfig } from "./connectors-config.js";

/**
 * The relay's own body parser, mounted before the daemon's 100 KB default when Connectors are on:
 * a send carries a whole email or document, and a body-parser 413 would reach the agent as an
 * HTTP failure instead of a tool result.
 */
export function mountConnectorRelayBodyParser(
  app: express.Express,
  config: ConnectorsConfig | undefined,
): void {
  if (config?.enabled) app.use(CONNECTORS_RELAY_ROUTE, express.json({ limit: "16mb" }));
}

/**
 * Everything the daemon wires for Connectors (docs/features/connectors/README.md), in one place
 * so `bootstrap.ts` gains a few calls and nothing else. Flag off: no service, no route, no MCP
 * entries; the daemon stays upstream-equivalent.
 */
export interface ConnectorsDaemon {
  service: ConnectorService | null;
  mountRelay(app: express.Express): void;
  /** Called once the daemon listens, with the agent MCP URL it derives other URLs from. */
  setListenUrl(agentMcpUrl: string | null): void;
  /** Stops the local MCP servers the relay started, waiting until each has exited. */
  stop(): Promise<void>;
  /**
   * The Clisbot and browser tools an agent may call now, from what the launch and the Host give
   * (`connector-agent-tools.ts`); with Connectors off, that base unchanged.
   */
  agentToolAccess(agentId: string, base: AgentToolAccess): Promise<AgentToolAccess>;
}

export function createConnectorsDaemon(params: {
  config: ConnectorsConfig | undefined;
  clisbotHome: string;
  logger: Logger;
  botService: BotService | null;
  agentManager: AgentManager;
  projectRegistry: ProjectRegistry;
  workspaceRegistry: WorkspaceRegistry;
  /** The Host's "Browser tools" switch now. */
  browserToolsEnabled(): boolean;
  /** A Chat's tools off list; absent when the daemon runs no Chats. */
  chatToolsOff?(chatId: string): Promise<readonly string[]>;
  /** Every Chat's list, to follow a renamed or removed MCP server; absent without Chats. */
  chatOffLists?: ChatOffLists;
}): ConnectorsDaemon {
  const service = createConnectorServiceFromConfig(params.config, {
    clisbotHome: params.clisbotHome,
    logger: params.logger,
  });
  const projects = createConnectorProjectDirectory({
    projectRegistry: params.projectRegistry,
    workspaceRegistry: params.workspaceRegistry,
    botService: params.botService,
    agentLabels: (agentId) => params.agentManager.getAgent(agentId)?.labels,
    agentCwd: (agentId) => params.agentManager.getAgent(agentId)?.cwd,
    agentState: (agentId) => {
      const agent = params.agentManager.getAgent(agentId);
      if (!agent) return "gone";
      return agent.lifecycle === "closed" ? "closed" : "active";
    },
    ...(params.chatToolsOff ? { chatToolsOff: params.chatToolsOff } : {}),
  });
  const runtime = service ? new ConnectorRuntime(service, projects) : null;
  if (runtime) {
    runtime.setPermissionHost(params.agentManager);
    params.agentManager.setRuntimeMcpServers((input) => runtime.mcpServersForAgent(input));
  }
  // Skills follow the same off list as tools: the session's label and its Chat's.
  if (service) params.agentManager.setSessionOffSource((agentId) => projects.offList(agentId));
  service?.setAgentToolDefaults(() => ({
    agentTools: params.agentManager.areClisbotToolsEnabled(),
    browserTools: params.browserToolsEnabled(),
  }));
  const stdio = createStdioServers({ logger: params.logger });
  service?.onMcpServerChanged((change) => {
    void stdio.stopServer(change.from);
    renameServerInOffLists(params.agentManager, change).catch((error: unknown) =>
      params.logger.warn({ err: error, change }, "Could not update sessions' Connector off lists"),
    );
    if (params.chatOffLists) {
      renameServerInChatLists(params.chatOffLists, change).catch((error: unknown) =>
        params.logger.warn({ err: error, change }, "Could not update Chats' tools off lists"),
      );
    }
  });
  return {
    service,
    mountRelay(app) {
      if (runtime) new ConnectorRelay(runtime, stdio, params.logger).mount(app);
    },
    stop() {
      return stdio.stopAll();
    },
    async agentToolAccess(agentId, base) {
      if (!service) return base;
      const stored = await service.store.sessionAllows();
      const allows = projects.allowOwners(agentId).flatMap((owner) => stored[owner] ?? []);
      return agentToolAccess({
        agentId,
        base,
        projects,
        grants: () => service.store.projectGrants(),
        sessionAllows: new Set(allows),
      });
    },
    setListenUrl(agentMcpUrl) {
      runtime?.setRelayBaseUrl(
        agentMcpUrl ? new URL(CONNECTORS_RELAY_ROUTE, agentMcpUrl).toString() : null,
      );
    },
  };
}
