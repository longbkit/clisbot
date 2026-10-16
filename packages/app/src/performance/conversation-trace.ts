/** Native profiling hook; ordinary web/Node consumers do not load native modules. */
export const traceConversationPhase: (
  phase: string,
  key: string,
  extra?: Record<string, string>,
) => void = () => undefined;
