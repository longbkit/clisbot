// The inbox's card half (D-WA-032): a reaction on an approval or question
// prompt becomes the matching button's `callback` event.
import type { WAMessage } from "baileys";
import type { ChannelInboundEvent, HostChildLogger, HostKeyedStore } from "@clisbot/channels-shared";
import { buildWhatsAppCardCallbackEvent } from "./inbound-adapter.js";
import { matchReaction, type StoredReactionCard } from "./reaction-cards.js";

export interface WhatsAppCardIntakeOptions {
  accountId: string;
  cards: HostKeyedStore<StoredReactionCard>;
  /** The linked account's own JID (a reaction the owner sent from the phone). */
  selfJid: () => string | null | undefined;
  /** A reactor JID → the sender id the Hub sees (E.164 when known). */
  resolveActorId: (jid: string) => Promise<string | null>;
  admit: (event: ChannelInboundEvent) => Promise<boolean>;
  logger?: HostChildLogger;
}

export function createWhatsAppCardIntake(options: WhatsAppCardIntakeOptions) {
  /** True when `msg` was a reaction (handled here, whether or not it answered a card). */
  const handleReaction = async (msg: WAMessage): Promise<boolean> => {
    const reaction = msg.message?.reactionMessage;
    if (!reaction) return false;
    const cardId = reaction.key?.id;
    const emoji = reaction.text ?? "";
    if (!cardId || emoji === "") return true;
    const card = await options.cards.lookup(cardId);
    const choice = card && matchReaction(card, emoji);
    if (!card || !choice) return true;
    const actorJid = msg.key?.fromMe
      ? (options.selfJid() ?? "")
      : (msg.key?.participant ?? msg.key?.remoteJid ?? "");
    const actorId = (await options.resolveActorId(actorJid)) ?? actorJid;
    const build = buildWhatsAppCardCallbackEvent({ msg, cardMessageId: cardId, chatJid: card.chatJid, choice, actorId });
    if (!build.admit) return true;
    options.logger?.info?.(`[${options.accountId}] WhatsApp card ${cardId} answered by reaction ${emoji}`);
    await options.admit(build.event);
    return true;
  };
  return { handleReaction } as const;
}
