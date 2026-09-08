// upstream: src/plugin-sdk/agent-runtime.ts@5d8067a4483
// D-CORE-305: upstream's barrel is the deprecated broad agent surface — model
// catalog, auth profiles, agent scope, TTS, ingress agent commands. Fusion's
// daemon owns the agent runtime (D-CORE-010), so only the agent-tool parameter
// readers the ported Discord action handlers call are carried; they come from
// the same upstream module the barrel names (`src/agents/tools/common.ts`).
export {
  readNonNegativeIntegerParam,
  readPositiveIntegerParam,
  readStringArrayParam,
  readToolStringParam as readStringParam,
} from "../agents/tools/common.host-adapter.js";
