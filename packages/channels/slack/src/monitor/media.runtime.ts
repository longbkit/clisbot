// upstream: extensions/slack/src/monitor/media.runtime.ts@5d8067a4483
// Slack plugin module implements media behavior.
import { createSubsystemLogger } from "@getpaseo/channels-core/plugin-sdk/runtime-env";

export const slackMediaLog = createSubsystemLogger("gateway/channels/slack").child("media");
export { fetchWithRuntimeDispatcher } from "../fusion/media-runtime.js";
export type { FetchLike } from "../fusion/media-runtime.js";
export { saveRemoteMedia } from "../fusion/media-runtime.js";
