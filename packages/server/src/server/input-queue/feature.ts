interface InputQueueFeatureOwner {
  hostInputQueue?: boolean;
  agentSessionStorage?: boolean;
}
export function hostInputQueueEnabled(config: InputQueueFeatureOwner): boolean {
  return config.hostInputQueue !== false && config.agentSessionStorage === true;
}
