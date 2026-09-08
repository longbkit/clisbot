// upstream: extensions/zalo/src/actions.runtime.ts@5d8067a4483
// Zalo plugin module implements actions behavior.
import { sendMessageZalo as sendMessageZaloImpl } from "./send.js";

export const zaloActionsRuntime = {
  sendMessageZalo: sendMessageZaloImpl,
};
