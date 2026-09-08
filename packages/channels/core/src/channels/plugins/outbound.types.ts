// upstream: src/channels/plugins/outbound.types.ts@5d8067a4483
// D-CORE-212: the upstream module also declares the full outbound adapter graph
// (ReplyPayload, OpenClawConfig, approval types, deliver/formatting/identity/send-dep
// contracts, media load options). Fusion owns delivery; only the presentation
// capability contract the ported Slack presentation/blocks files read is carried,
// plus a narrowed `ChannelOutboundAdapter` shell that keeps the upstream
// `ChannelOutboundAdapter["presentationCapabilities"]` indexed-access spelling
// working at the call sites. See upstream-sync.json.
import type { ReplyPayload } from "../../auto-reply/reply-payload.js";
import type { MessagePresentation } from "../../interactive/payload.js";

export type ChannelPresentationCapabilities = {
  /** Whether the channel accepts structured presentation payloads at all. */
  supported?: boolean;
  /** Whether the channel can render button action blocks natively. */
  buttons?: boolean;
  /** Whether the channel can render select/menu blocks natively. */
  selects?: boolean;
  /** Whether the channel can render low-emphasis context blocks natively. */
  context?: boolean;
  /** Whether the channel can render divider blocks natively. */
  divider?: boolean;
  /** Whether the channel can render chart blocks natively. */
  charts?: boolean;
  /** Whether the channel can render table blocks natively. */
  tables?: boolean;
  /** Per-channel limits used to adapt portable presentation blocks before rendering. */
  limits?: {
    actions?: {
      /** Maximum total button/select actions in one message. */
      maxActions?: number;
      /** Maximum buttons per rendered action row. */
      maxActionsPerRow?: number;
      /** Maximum action rows in one message. */
      maxRows?: number;
      /** Maximum user-visible button label length. */
      maxLabelLength?: number;
      /** Maximum callback/action value size in UTF-8 bytes. */
      maxValueBytes?: number;
      /** Whether action styles such as primary or danger are preserved. */
      supportsStyles?: boolean;
      /** Whether disabled button state is preserved. */
      supportsDisabled?: boolean;
      /** Whether priority/layout hints affect native rendering. */
      supportsLayoutHints?: boolean;
    };
    selects?: {
      /** Maximum options in one select/menu block. */
      maxOptions?: number;
      /** Maximum user-visible option label length. */
      maxLabelLength?: number;
      /** Maximum option callback value size in UTF-8 bytes. */
      maxValueBytes?: number;
    };
    text?: {
      /** Maximum text length for title, text, and context blocks. */
      maxLength?: number;
      /** Unit used by maxLength. Defaults to Unicode code points. */
      encoding?: "characters" | "utf8-bytes" | "utf16-units";
      /** Markdown dialect understood by rendered text blocks. */
      markdownDialect?: "plain" | "markdown" | "html" | "slack-mrkdwn" | "discord-markdown";
      /** Whether the channel can edit presentation text in-place. */
      supportsEdit?: boolean;
    };
  };
};

/**
 * Narrowed outbound adapter shell: the presentation capability slot, plus the
 * send-shape probes and delivery mode the ported message-action layer reads
 * (`hasCorePresentationDelivery` in `infra/outbound/outbound-send-service.ts`,
 * the gateway-mode branch in `message-action-routing.ts`). The transports
 * themselves stay with the Hub, so the send members are declared, not typed out.
 */
export type ChannelOutboundAdapter = {
  presentationCapabilities?: ChannelPresentationCapabilities;
  /** Core delivery ("direct") or delegated to a live account runtime ("gateway"). */
  deliveryMode?: "direct" | "gateway";
  sendText?: unknown;
  sendFormattedText?: unknown;
  /**
   * Slice 13 (Discord port): typed with upstream's `ChannelOutboundPayloadContext`
   * payload slot, because the ported Discord component adapter spells its own
   * payload type as `Parameters<NonNullable<ChannelOutboundAdapter["sendPayload"]>>[0]["payload"]`.
   * The delivery result stays with the Hub, so the return type is left open.
   */
  sendPayload?: (ctx: { payload: ReplyPayload }) => Promise<unknown>;
  sendMedia?: unknown;
  sendPoll?: unknown;
  pollMaxOptions?: number;
  /**
   * Slice 13 (Discord port): upstream's presentation renderer, typed for the same
   * indexed-access spelling the ported Discord presentation builder uses.
   */
  renderPresentation?: (params: {
    payload: ReplyPayload;
    presentation: MessagePresentation;
    sourcePresentation?: MessagePresentation;
  }) => Promise<ReplyPayload | null> | ReplyPayload | null;
};
