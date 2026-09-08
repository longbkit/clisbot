// upstream: src/plugin-sdk/channel-actions.ts@5d8067a4483
// Channel action helpers for plugins that implement message actions.
export { optionalPositiveIntegerSchema } from "../agents/schema/typebox.js";
export { resolveReactionMessageId } from "../channels/plugins/actions/reaction-message-id.js";
export {
  createUnionActionGate,
  listTokenSourcedAccounts,
} from "../channels/plugins/actions/shared.js";
// Slice 9b: the string-or-number reader now comes from the carried
// `src/agents/tools/common.ts` copy, whose `required` option the ported Telegram
// action runtime passes. The narrowed `shared/param-readers.ts` copy stays for
// its other callers.
export { readStringOrNumberParam } from "../agents/tools/common.host-adapter.js";
// Slice 10b: upstream's barrel spells `readStringParam` as the agent-tool
// reader (`readToolStringParam`), whose `required` / `allowEmpty` options the
// ported Slack actions pass. The narrowed `shared/param-readers.ts` copy stays
// for `readStringOrNumberParam`.
export { readToolStringParam as readStringParam } from "../agents/tools/common.host-adapter.js";
// D-CORE-211: the upstream barrel also re-exports `jsonResult`, the boolean /
// positive-integer / string-array / reaction param readers, `resolvePollMaxSelections`
// and the sandbox path helpers from `src/agents/tools/common.ts`,
// `src/agents/date-time.ts`, `src/agents/sandbox-paths.ts` and `src/polls.ts`.
// Those are agent-tool-runner surfaces; they land with the message-action runner
// slice (goal ledger slice 11). See upstream-sync.json.

// Slice 10b additions (Slack send/actions port). Same upstream barrel, same
// source modules: the action gate and reaction/param readers come from
// `src/agents/tools/common.ts` (D-CORE-029) and the timestamp decorator from
// `src/agents/date-time.ts`.
export {
  createActionGate,
  jsonResult,
  readPositiveIntegerParam,
  readReactionParams,
  textResult,
  type ActionGate,
} from "../agents/tools/common.host-adapter.js";
export { withNormalizedTimestamp } from "../agents/date-time.js";
export { imageResultFromFile } from "../agents/tools/image-result.host-adapter.js";

// Slice 9b additions (Telegram action-runtime port). Same upstream barrel, same
// source modules: the string-array reader from `src/agents/tools/common.ts`
// (D-CORE-029) and the poll selection resolver from `src/polls.ts`.
export { readStringArrayParam } from "../agents/tools/common.host-adapter.js";
export { resolvePollMaxSelections } from "../polls.js";


// Slice 13 additions (Discord vertical port). Same upstream barrel, same source
// modules: the non-negative integer and forum-tag readers from
// `src/agents/tools/common.ts` (D-CORE-029) and the data-URL guard from
// `src/infra/outbound/message-action-params.ts`.
export {
  parseAvailableTags,
  readNonNegativeIntegerParam,
  type AvailableTag,
} from "../agents/tools/common.host-adapter.js";
export { assertMediaNotDataUrl } from "../agents/sandbox-paths.host-adapter.js";

// Slice 15 addition (Feishu vertical port): the ported Feishu read policy
// refuses an unauthorized chat read with upstream's tool authorization error.
// Same upstream barrel, same source module (`src/agents/tools/common.ts`).
export { ToolAuthorizationError } from "../agents/tool-input-error.js";

// Slice 17 addition (Zalo Personal vertical port): the ported `tool.ts` builds
// its action parameter with upstream's provider-safe TypeBox string enum. Same
// upstream barrel, same source module (`src/agents/schema/string-enum.ts`).
export { optionalStringEnum, stringEnum } from "../agents/schema/string-enum.js";
