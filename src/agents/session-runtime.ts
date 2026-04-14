export type SessionRuntimeInfo = {
  state: "idle" | "running" | "detached";
  startedAt?: number;
  detachedAt?: number;
  finalReplyAt?: number;
  lastMessageToolReplyAt?: number;
  messageToolFinalReplyAt?: number;
  sessionKey: string;
  agentId: string;
};
