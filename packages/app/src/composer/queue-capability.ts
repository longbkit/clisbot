/** Unknown transport/capability never transfers accepted ownership between queues. */
export function resolveQueueCapability(input: {
  connected: boolean;
  serverInfo: { features?: { hostInputQueue?: boolean } } | null | undefined;
}): "host" | "client" | "unknown" {
  if (!input.connected || !input.serverInfo) return "unknown";
  return input.serverInfo.features?.hostInputQueue === true ? "host" : "client";
}
