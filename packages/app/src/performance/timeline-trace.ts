/** Native profiling hook; ordinary web/Node consumers do not load native modules. */
export const traceTimelinePhase: (
  phase: string,
  serverId: string,
  agentId?: string,
  extra?: Record<string, string>,
) => void = () => undefined;
