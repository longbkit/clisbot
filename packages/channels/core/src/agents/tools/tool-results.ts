// upstream: src/agents/tools/tool-results.ts@5d8067a4483
import type { AgentToolResult } from "../runtime/index.host-adapter.js";

export function textResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

export function jsonResult<TDetails>(payload: TDetails): AgentToolResult<TDetails> {
  return textResult(JSON.stringify(payload, null, 2), payload);
}
