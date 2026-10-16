/** Native profiling hook; ordinary web/Node consumers do not load native modules. */
export const traceConversationPhase: (
  phase: string,
  key: string,
  extra?: Record<string, string>,
) => void = () => undefined;

export const traceConversationFetch: (
  key: string,
  direction: "tail" | "before" | "after",
) => ((payload: { lines: readonly unknown[]; error: string | null }) => void) | undefined = () =>
  undefined;
