export const DEFAULT_TOOL_CALL_DETAIL_LEVEL = "summary-with-latest-call" as const;
export const TOOL_CALL_DETAIL_LEVELS = [
  "detailed",
  "overview",
  DEFAULT_TOOL_CALL_DETAIL_LEVEL,
] as const;
export type ToolCallDetailLevel = (typeof TOOL_CALL_DETAIL_LEVELS)[number];
