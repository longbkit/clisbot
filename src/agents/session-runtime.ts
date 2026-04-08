export type SessionRuntimeInfo = {
  state: "idle" | "running" | "detached";
  startedAt?: number;
  detachedAt?: number;
  sessionKey: string;
  agentId: string;
};
