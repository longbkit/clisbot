import type { OpenPreloadScheduler } from "./scheduler";

export interface AgentOpenTarget {
  serverId: string;
  agentId: string;
}

export interface ChatOpenTarget {
  serverId: string;
  chatId: string;
  /** The signed-in principal the chat route will present for (`useResourcePrincipalScope`). */
  presentationScope: string;
}

export interface OpenPreloadPorts {
  loadAgent(target: AgentOpenTarget): Promise<void>;
  loadChat(target: ChatOpenTarget): Promise<void>;
}

export interface OpenPreloads {
  preloadAgent(target: AgentOpenTarget): void;
  preloadChat(target: ChatOpenTarget): void;
  cancelAgent(target: AgentOpenTarget): void;
  cancelQueued(): void;
}

function agentKey(target: AgentOpenTarget): string {
  return `agent\u0000${target.serverId}\u0000${target.agentId}`;
}

function chatKey(target: ChatOpenTarget): string {
  return `chat\u0000${target.serverId}\u0000${target.chatId}\u0000${target.presentationScope}`;
}

export function createOpenPreloads(
  scheduler: OpenPreloadScheduler,
  ports: OpenPreloadPorts,
): OpenPreloads {
  return {
    preloadAgent: (target) => scheduler.request(agentKey(target), () => ports.loadAgent(target)),
    preloadChat: (target) => scheduler.request(chatKey(target), () => ports.loadChat(target)),
    cancelAgent: (target) => scheduler.cancel(agentKey(target)),
    cancelQueued: () => scheduler.cancelQueued(),
  };
}
