// Fusion-owned: the outbound seam's presentation rendering (D-TG-057, the
// Telegram half of D-W6-01).
//
// Upstream renders a portable `presentation` through core's delivery adapter:
// the channel declares what it can draw and core adapts the presentation to
// those capabilities before the channel renders it
// (`renderPresentationForDelivery` -> `adaptMessagePresentationForChannel`).
// Fusion's Hub drives `plugin.outbound.sendText` instead of core's delivery
// adapter, so the same two steps run here: adapt the presentation to THIS
// account's capabilities, then render it into the one payload shape every
// Telegram send funnel takes (`canonicalizeTelegramPresentationPayload`).
//
// The rendering itself is the ported one. On a rich account a table becomes a
// `<table>` island, which the island -> rich-block converter turns into a
// native Bot API 10.3 `table` block; on a plain account the table degrades to
// the portable fallback text the HTML send path posts. Telegram has no chart
// primitive at all, so a chart is always fallback text.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import {
  admitMessagePresentation,
  type MessagePresentationBlockNote,
} from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";
import { mergeTelegramAccountConfig } from "./accounts.js";
import {
  canonicalizeTelegramPresentationPayload,
  resolveTelegramPresentationCapabilities,
} from "./interactive-fallback.js";

/**
 * What `plugin.outbound` declares (upstream's `presentationCapabilities`
 * spelling; the Hub reads it to decide whether core flattens a presentation
 * before the seam).
 *
 * One plugin object serves every account of every organization, so the
 * declaration is the vertical's maximum — a rich account. The account's own
 * limits are resolved per send by `resolveTelegramOutboundPresentation`, which
 * is where the cfg and the account id exist.
 */
export const TELEGRAM_PRESENTATION_CAPABILITIES = resolveTelegramPresentationCapabilities({
  richMessages: true,
});

/**
 * True when this account's sends take the Bot API 10.3 rich path.
 *
 * The same predicate the ported send path applies (`send-message.ts`
 * `useRichMessages`), read from the drive-time cfg the Hub hands the vertical:
 * rich blocks are opt-in per account, so a table island only becomes a native
 * `table` block where `richMessages` is on.
 */
export function accountRendersRichMessages(params: {
  cfg: OpenClawConfig;
  accountId: string;
}): boolean {
  return mergeTelegramAccountConfig(params.cfg, params.accountId).richMessages === true;
}

/** The text (and inline keyboard) one outbound `presentation` renders into. */
export interface TelegramOutboundPresentation {
  /** Absent when the value carries no renderable presentation — the caller then
   * posts its own text unchanged. */
  text?: string;
  /** The keyboard the presentation's controls compiled into, in the ported
   * button shape `sendMessageTelegram` takes. */
  buttons?: unknown;
  /** D-W6-02: the blocks admission repaired or the normalizer refused. */
  notes: readonly MessagePresentationBlockNote[];
}

/**
 * Renders one outbound `presentation` for the account that is about to post it.
 *
 * `richMessages` is a parameter so a test can assert both account shapes
 * without a second config; production passes `accountRendersRichMessages`.
 */
export function resolveTelegramOutboundPresentation(params: {
  text: string;
  presentation: unknown;
  richMessages: boolean;
}): TelegramOutboundPresentation {
  // Admission first: a table the model wrote without a caption keeps its data
  // instead of vanishing between the tool call and the channel (D-W6-02).
  const { presentation, notes } = admitMessagePresentation(params.presentation);
  if (!presentation) return { notes };
  const canonical = canonicalizeTelegramPresentationPayload(
    { text: params.text, presentation },
    { richTables: params.richMessages },
  );
  const buttons = (canonical.channelData?.telegram as { buttons?: unknown } | undefined)?.buttons;
  return {
    ...(canonical.text === undefined ? {} : { text: canonical.text }),
    ...(buttons === undefined ? {} : { buttons }),
    notes,
  };
}
