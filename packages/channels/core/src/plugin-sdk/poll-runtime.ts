// upstream: src/plugin-sdk/poll-runtime.ts@5d8067a4483
/**
 * Runtime SDK subpath for poll input normalization and selection limits.
 */
export type { NormalizedPollInput, PollInput } from "../polls.js";
export {
  normalizePollDurationHours,
  normalizePollInput,
  resolvePollMaxSelections,
} from "../polls.js";
