/**
 * Command buttons are Hub-issued, never model-issued.
 *
 * A `message` tool call can carry `presentation.buttons` with a
 * `{ type: "command", command: "/new" }` action. The vertical turns that into
 * the platform's callback payload verbatim (Telegram `tgcmd:/new`), and the
 * inbound adapter hands the same text straight back as the callback's action
 * id. Left alone, the model writes a control that any member of the
 * conversation can click to run a session command, with no authority check and
 * no expiry.
 *
 * So the command text never leaves the Hub. Minting records the issuing
 * organization, account, agent, turn and conversation plus the actors allowed
 * to click, and returns an opaque `/cb-<id>` token that rides the platform's
 * command path unchanged (it still starts with `/`, so every vertical's
 * native-command encoder accepts it). Redemption is one-shot and TTL-bounded,
 * and refuses a token issued for another organization, account, conversation
 * or actor. A callback this Hub never minted is not a command.
 *
 * The map is process-local on purpose: a token is only worth redeeming while
 * the Hub that posted the card is still running, and a restart that forgets a
 * button is a refused click, not a wrong one.
 */
import { randomUUID } from "node:crypto";
import {
  resolveMessagePresentationButtonAction,
  resolveMessagePresentationOptionAction,
  type MessagePresentation,
} from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";

/** How long a posted command button stays clickable. */
export const CHANNEL_COMMAND_BUTTON_TTL_MS = 15 * 60_000;

/** The ceiling on live tokens; the oldest is evicted past it, so a chatty
 * agent cannot grow the map without bound. */
const MAX_OPEN_COMMAND_BUTTONS = 512;

const COMMAND_BUTTON_PREFIX = "/cb-";

/** Who issued a command button, and who may click it. */
export interface ChannelCommandButtonIssuer {
  organizationId: string;
  channel: string;
  accountId: string;
  /** The agent whose turn asked for the button. */
  agentId: string;
  /** The turn (tool call) that asked for it, when the caller tracks one. */
  turnId?: string | undefined;
  /** The conversation the card is posted into. */
  conversationId: string;
  threadId?: string | undefined;
  /** External sender ids allowed to click. Empty mints nothing. */
  allowedActorIds: readonly string[];
}

/** One click, as the inbound callback reports it. */
export interface ChannelCommandButtonClick {
  organizationId: string;
  channel: string;
  accountId: string;
  conversationId: string;
  /** The native thread/topic the click arrived in, when the callback names one. */
  threadId?: string | undefined;
  actorId?: string | undefined;
}

export type ChannelCommandButtonRefusal =
  | "unknown"
  | "expired"
  | "foreign-account"
  | "foreign-conversation"
  | "foreign-actor";

export type ChannelCommandButtonRedemption =
  | { ok: true; command: string; issuer: ChannelCommandButtonIssuer }
  | { ok: false; reason: ChannelCommandButtonRefusal };

interface MintedCommandButton {
  command: string;
  issuer: ChannelCommandButtonIssuer;
  expiresAt: number;
}

/** Insertion-ordered, so eviction and the expiry sweep both walk it front-first. */
const minted = new Map<string, MintedCommandButton>();

/** True for a value this module issued. Shape only — say nothing about validity. */
export function isChannelCommandButtonToken(value: string): boolean {
  return value.startsWith(COMMAND_BUTTON_PREFIX);
}

/**
 * Record one command and return the token that stands in for it. The command
 * text is not encoded in the token: it is only reachable through `redeem`.
 */
export function mintChannelCommandButton(
  command: string,
  issuer: ChannelCommandButtonIssuer,
  options: { now?: number; ttlMs?: number } = {},
): string {
  if (issuer.allowedActorIds.length === 0) {
    throw new Error("a command button needs at least one allowed actor");
  }
  const now = options.now ?? Date.now();
  sweep(now);
  const token = `${COMMAND_BUTTON_PREFIX}${randomUUID().replaceAll("-", "")}`;
  minted.set(token, {
    command,
    issuer: { ...issuer, allowedActorIds: [...issuer.allowedActorIds] },
    expiresAt: now + (options.ttlMs ?? CHANNEL_COMMAND_BUTTON_TTL_MS),
  });
  while (minted.size > MAX_OPEN_COMMAND_BUTTONS) {
    const oldest = minted.keys().next();
    if (oldest.done === true) break;
    minted.delete(oldest.value);
  }
  return token;
}

/**
 * Spend a token. Success consumes it, so a second click on the same button is
 * refused as `unknown` — one posted control, one command.
 */
export function redeemChannelCommandButton(
  token: string,
  click: ChannelCommandButtonClick,
  options: { now?: number } = {},
): ChannelCommandButtonRedemption {
  const now = options.now ?? Date.now();
  const entry = minted.get(token);
  if (entry === undefined) return { ok: false, reason: "unknown" };
  if (entry.expiresAt <= now) {
    minted.delete(token);
    return { ok: false, reason: "expired" };
  }
  const refusal = refuse(entry.issuer, click);
  if (refusal !== undefined) return { ok: false, reason: refusal };
  minted.delete(token);
  return { ok: true, command: entry.command, issuer: entry.issuer };
}

/** Drop an account's live tokens; its buttons stop working when it stops. */
export function clearChannelCommandButtons(channel: string, accountId: string): void {
  for (const [token, entry] of minted) {
    if (entry.issuer.channel === channel && entry.issuer.accountId === accountId) {
      minted.delete(token);
    }
  }
}

/**
 * Rewrite every command action in one presentation into a minted token. The
 * outbound path calls this before the vertical sees the payload, so what the
 * platform stores in its callback data is the token and never the command.
 */
export function mintPresentationCommandButtons(
  presentation: MessagePresentation,
  issuer: ChannelCommandButtonIssuer,
  options: { now?: number; ttlMs?: number } = {},
): MessagePresentation {
  const mint = (command: string): string => mintChannelCommandButton(command, issuer, options);
  return {
    ...presentation,
    blocks: presentation.blocks.map((block) => {
      if (block.type === "buttons") {
        return { ...block, buttons: block.buttons.map((button) => mintButton(button, mint)) };
      }
      if (block.type === "select") {
        return { ...block, options: block.options.map((option) => mintOption(option, mint)) };
      }
      return block;
    }),
  };
}

type PresentationButton = Extract<MessagePresentation["blocks"][number], { type: "buttons" }>;
type PresentationSelect = Extract<MessagePresentation["blocks"][number], { type: "select" }>;

function mintButton(
  button: PresentationButton["buttons"][number],
  mint: (command: string) => string,
): PresentationButton["buttons"][number] {
  const action = resolveMessagePresentationButtonAction(button);
  if (action?.type !== "command") return button;
  const { value: _discarded, ...rest } = button;
  return { ...rest, action: { type: "command", command: mint(action.command) } };
}

function mintOption(
  option: PresentationSelect["options"][number],
  mint: (command: string) => string,
): PresentationSelect["options"][number] {
  const action = resolveMessagePresentationOptionAction(option);
  if (action?.type !== "command") return option;
  const { value: _discarded, ...rest } = option;
  return { ...rest, action: { type: "command", command: mint(action.command) } };
}

/** The first authority check the click fails, or undefined when it passes. */
function refuse(
  issuer: ChannelCommandButtonIssuer,
  click: ChannelCommandButtonClick,
): ChannelCommandButtonRefusal | undefined {
  if (
    issuer.organizationId !== click.organizationId ||
    issuer.channel !== click.channel ||
    issuer.accountId !== click.accountId
  ) {
    return "foreign-account";
  }
  if (issuer.conversationId !== click.conversationId) return "foreign-conversation";
  // The thread is part of the location a button was posted into: a control
  // minted in one topic must not run against the session of another. Checked
  // only when the callback names a thread — a vertical that reports none has
  // told us nothing, and refusing on silence would break every button in a
  // thread on that channel rather than the one click that is out of place.
  if (
    issuer.threadId !== undefined &&
    click.threadId !== undefined &&
    issuer.threadId !== click.threadId
  ) {
    return "foreign-conversation";
  }
  if (click.actorId === undefined || !issuer.allowedActorIds.includes(click.actorId)) {
    return "foreign-actor";
  }
  return undefined;
}

/** Drop expired entries. The map is capped, so a full walk per mint is cheaper
 * than carrying a timer that would have to be unref'd and torn down. */
function sweep(now: number): void {
  for (const [token, entry] of minted) {
    if (entry.expiresAt <= now) minted.delete(token);
  }
}
