// upstream: src/plugin-sdk/reply-reference.ts@5d8067a4483
// Reply/thread reference planning for multi-payload channel sends.
export {
  createReplyReferencePlanner,
  isSingleUseReplyToMode,
} from "../auto-reply/reply/reply-reference.js";
// D-CORE-220: the upstream barrel also re-exports the reply-threading planner
// and `GetReplyOptions`, which belong to the OpenClaw reply pipeline.
