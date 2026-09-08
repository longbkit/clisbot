// upstream: src/channels/plugins/outbound/interactive.ts@5d8067a4483
/**
 * Interactive outbound compatibility helpers.
 *
 * Re-exports presentation adapters and keeps the deprecated interactive reducer available.
 */
import { reduceLegacyInteractiveReply } from "../../../interactive/payload.js";
export {
  adaptMessagePresentationForChannel,
  applyPresentationActionLimits,
  presentationPageSize,
} from "./presentation-limits.js";

/** @deprecated Use MessagePresentation helpers for new rendering paths. */
export const reduceInteractiveReply = reduceLegacyInteractiveReply;
