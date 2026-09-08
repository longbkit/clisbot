// upstream: src/plugin-sdk/error-runtime.ts@5d8067a4483
// Error normalization helpers for plugin runtimes.
export {
  collectErrorGraphCandidates,
  extractErrorCode,
  formatErrorMessage,
  formatErrorMessageWithCode,
  formatUncaughtError,
  readErrorName,
  toErrorObject,
} from "../infra/errors.js";
export { PlatformMessageNotDispatchedError } from "../infra/outbound/deliver-types.js";
// D-CORE-213: the upstream barrel also re-exports the approval error classes
// (`src/infra/approval-errors.ts`) and the error-diagnostics reporters
// (`src/infra/error-diagnostics.ts`), which are host surfaces the port stops at.
