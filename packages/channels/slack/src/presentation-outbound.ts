// Fusion-owned: the outbound seam's presentation rendering (D-W6-01).
//
// Upstream renders a portable `presentation` on its own outbound adapter:
// `slackOutbound.presentationCapabilities` + `slackOutbound.renderPresentation`
// (`extensions/slack/src/outbound-adapter.ts@5d8067a4483:259`), and core adapts
// the presentation to those capabilities before calling the renderer
// (`renderPresentationForDelivery` → `adaptMessagePresentationForChannel`).
//
// Fusion's Hub drives `plugin.outbound.sendText` instead of core's delivery
// adapter, so the same two steps happen here: adapt the portable presentation
// to Slack's declared capabilities, then compile it into the ordered Block Kit
// messages the ported send path posts (`reply-blocks.ts`, the same compiler the
// `message` tool's `handleAction` send uses). A presentation Slack cannot render
// natively degrades to the fallback text the compiler emits — never to nothing.
import {
  adaptMessagePresentationForChannel,
  admitMessagePresentation,
  type MessagePresentationBlockNote,
} from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";
import type { ChannelOutboundAdapter } from "@getpaseo/channels-core/plugin-sdk/channel-send-result";
import { SLACK_PRESENTATION_CAPABILITIES } from "./presentation.js";
import {
  resolveSlackReplyBlockResolution,
  resolveSlackReplyDeliveryMessages,
  type SlackReplyDeliveryMessage,
} from "./reply-blocks.js";

/** The compiled Slack messages plus what admission repaired or refused. */
export interface SlackOutboundPresentation {
  /** Empty when the value carries no renderable presentation — the caller then
   * posts its plain text unchanged. */
  messages: SlackReplyDeliveryMessage[];
  /** D-W6-02: the blocks admission repaired or the normalizer refused. */
  notes: readonly MessagePresentationBlockNote[];
}

/**
 * Compiles one outbound `presentation` into the messages Slack posts.
 *
 * `capabilities` is a parameter so a test can assert the capability-absent
 * behaviour — the declared Slack limits are the default and the only value the
 * vertical ever passes.
 */
export function resolveSlackOutboundPresentationMessages(params: {
  text: string;
  presentation: unknown;
  capabilities?: ChannelOutboundAdapter["presentationCapabilities"];
}): SlackOutboundPresentation {
  // Admission first: a table the model wrote without a caption keeps its data
  // instead of vanishing between the tool call and the channel (D-W6-02).
  const { presentation, notes } = admitMessagePresentation(params.presentation);
  if (!presentation) return { messages: [], notes };
  const adapted = adaptMessagePresentationForChannel({
    presentation,
    capabilities: params.capabilities ?? SLACK_PRESENTATION_CAPABILITIES,
  });
  const resolution = resolveSlackReplyBlockResolution(
    { text: params.text, presentation: adapted },
    { materializeAuthoredText: true },
  );
  if (resolution.segments.length === 0) return { messages: [], notes };
  return {
    messages: resolveSlackReplyDeliveryMessages({
      authoredTextPlacement: resolution.authoredTextPlacement,
      segments: resolution.segments,
      text: params.text,
    }),
    notes,
  };
}
