// Fusion-owned boundary for `src/plugin-sdk/channel-config-schema.ts` (D-CORE-340).
//
// Upstream's barrel re-exports ~40 members: the channel config builders below
// plus the streaming/markdown/TTS/exec-approval schema fragments from
// `src/config/zod-schema.*`, the implicit-mention schema, the tool policy and
// two infra path validators. Fusion's Hub owns config compilation, so only the
// builders and policy enums the ported channel config schemas reference are
// carried, from the same source modules upstream names.
export {
  AllowFromListSchema,
  ChannelGroupEntrySchema,
  buildCatchallMultiAccountChannelSchema,
  buildChannelConfigSchema,
  buildGroupEntrySchema,
  buildMultiAccountChannelSchema,
  buildNestedDmConfigSchema,
  emptyChannelConfigSchema,
} from "../channels/plugins/config-schema.js";
export {
  ContextVisibilityModeSchema,
  DmPolicySchema,
  GroupPolicySchema,
  ReplyToModeSchema,
} from "../config/zod-schema.core.js";
export { ToolPolicySchema } from "../config/zod-schema.agent-runtime.js";
export type {
  ChannelConfigRuntimeIssue,
  ChannelConfigRuntimeParseResult,
  ChannelConfigSchema,
  ChannelConfigUiHint,
} from "../channels/plugins/types.config.js";
