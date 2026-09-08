// Fusion-owned boundary for `src/plugin-sdk/plugin-entry.ts` (D-CORE-331).
//
// Upstream's barrel is the plugin host's whole entry surface: definitions,
// capability catalogs, provider/agent-harness plugin shapes, migration
// providers and the lazy-value getter. Fusion has no plugin host, so only the
// tool-factory contract the ported channel tool families read is carried, from
// the same source module upstream names (`src/plugins/tool-types.ts`, via the
// core host adapter).
export type {
  ConversationReadInvocationOrigin,
  DeliveryContext,
  OpenClawPluginApi,
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
  OpenClawPluginToolOptions,
  PluginLogger,
  ToolFsPolicy,
} from "../plugins/tool-types.host-adapter.js";
export type { OpenClawConfig } from "../config/types.openclaw.js";
