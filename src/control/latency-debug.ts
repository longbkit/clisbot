export type LatencyDebugPlatform = "slack" | "telegram" | "teams";

export type LatencyDebugContext = {
  platform?: LatencyDebugPlatform;
  eventId?: string;
  channelId?: string;
  chatId?: string;
  threadId?: string;
  topicId?: string;
  sessionKey?: string;
  sessionName?: string;
  agentId?: string;
};

type LatencyDebugDetails = Record<string, unknown>;

export function isLatencyDebugEnabled() {
  return process.env.CLISBOT_DEBUG_LATENCY === "1";
}

export function logLatencyDebug(
  stage: string,
  context: LatencyDebugContext = {},
  details: LatencyDebugDetails = {},
) {
  if (!isLatencyDebugEnabled()) {
    return;
  }

  console.log(
    `clisbot latency ${JSON.stringify({
      ts: new Date().toISOString(),
      stage,
      ...context,
      ...details,
    })}`,
  );
}
