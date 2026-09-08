// Fusion-owned boundary for `src/plugin-sdk/agent-core.ts` (D-CORE-242).
//
// Upstream's barrel wires OpenClaw's LLM runtime into `packages/agent-core`
// (Agent class, agent loop, session context, bash execution). The ported
// channel code reads exactly one thing from it: the tool-result shape an
// action returns. That type lives in the host adapter for
// `src/agents/runtime/index.ts` (D-CORE-006).
export type { AgentToolResult } from "../agents/runtime/index.host-adapter.js";
