// Fusion-owned poll vote decoding (D-WA-030).
//
// A WhatsApp vote is end-to-end encrypted with the poll's own `messageSecret`
// (`messageContextInfo.messageSecret` on the poll creation). Baileys 7 no longer
// decrypts votes itself — the block in its `process-message.js` is commented
// out — and OpenClaw's WhatsApp extension does not read votes at all. So the
// vertical keeps what a vote needs to be read later: per poll, the chat, the
// secret, the question and the options. They live in the account's keyed store
// (namespace `polls`), so a vote cast after a restart or days later still
// decodes; a poll this account never saw cannot be decoded, by design of the
// protocol.
//
// The decryption itself is Baileys' `decryptPollVote`, and an option is matched
// the way Baileys' `getAggregateVotesInPollMessage` matches it: by the SHA-256
// of its name. The vote's AAD binds the creator's and voter's JIDs; WhatsApp
// addresses a person by phone JID or LID depending on the chat, so each known
// spelling is tried until the authentication tag verifies.
import { createHash } from "node:crypto";
import { decryptPollVote, jidNormalizedUser, type proto, type WAMessage } from "baileys";
import type { HostKeyedStore, HostRuntime } from "@clisbot/channels-shared";

export const WHATSAPP_POLLS_NAMESPACE = "polls";
const POLL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type StoredWhatsAppPoll = {
  chatJid: string;
  /** Every JID spelling of the creator (phone JID, LID) seen with the poll. */
  creatorJids: string[];
  secret: string;
  question: string;
  options: string[];
};

export type WhatsAppPollVote = {
  pollId: string;
  chatJid: string;
  question: string;
  optionIds: number[];
  optionNames: string[];
};

export function openWhatsAppPollStore(hostRuntime: HostRuntime): HostKeyedStore<StoredWhatsAppPoll> {
  return hostRuntime.state.openKeyedStore({
    namespace: WHATSAPP_POLLS_NAMESPACE,
    maxEntries: 1000,
    overflowPolicy: "evict-oldest",
    defaultTtlMs: POLL_TTL_MS,
  }) as HostKeyedStore<StoredWhatsAppPoll>;
}

type PollCreation = { name?: string | null; options?: Array<{ optionName?: string | null }> | null };

function pollCreationOf(message: proto.IMessage | null | undefined): PollCreation | undefined {
  return (
    message?.pollCreationMessage ??
    message?.pollCreationMessageV2 ??
    message?.pollCreationMessageV3 ??
    (message as { pollCreationMessageV5?: PollCreation } | null | undefined)?.pollCreationMessageV5 ??
    undefined
  );
}

function normalized(jids: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const jid of jids) {
    if (jid) out.add(jidNormalizedUser(jid));
  }
  return [...out];
}

/**
 * The poll a message creates, ready to store, or undefined when the message is
 * not a poll or carries no secret. `selfJids` are the linked account's own
 * spellings, used when the account created the poll.
 */
export function readPollCreation(
  msg: Pick<WAMessage, "key" | "message">,
  selfJids: Array<string | null | undefined>,
): { id: string; poll: StoredWhatsAppPoll } | undefined {
  const creation = pollCreationOf(msg.message);
  const secret = msg.message?.messageContextInfo?.messageSecret;
  const id = msg.key?.id;
  const chatJid = msg.key?.remoteJid;
  if (!creation || !secret || !id || !chatJid) return undefined;
  const key = msg.key as WAMessage["key"] & { participantAlt?: string; remoteJidAlt?: string };
  const creatorJids = msg.key?.fromMe
    ? normalized(selfJids)
    : normalized([key.participant, key.participantAlt, chatJid, key.remoteJidAlt]);
  return {
    id,
    poll: {
      chatJid,
      creatorJids,
      secret: Buffer.from(secret).toString("base64"),
      question: creation.name ?? "",
      options: (creation.options ?? []).map((option) => option.optionName ?? ""),
    },
  };
}

function optionHash(name: string): string {
  return createHash("sha256").update(Buffer.from(name)).digest().toString();
}

/** The poll a vote message answers, and the voter's JID spellings. */
export function readPollVote(
  msg: Pick<WAMessage, "key" | "message">,
): { pollId: string; voterJids: string[]; vote: proto.Message.IPollEncValue } | undefined {
  const update = msg.message?.pollUpdateMessage;
  const pollId = update?.pollCreationMessageKey?.id;
  if (!update?.vote || !pollId) return undefined;
  const key = msg.key as WAMessage["key"] & { participantAlt?: string; remoteJidAlt?: string };
  const voterJids = msg.key?.participant
    ? normalized([key.participant, key.participantAlt])
    : normalized([key.remoteJid, key.remoteJidAlt]);
  return { pollId, voterJids, vote: update.vote };
}

/** Decrypts one vote against a stored poll; undefined when no spelling verifies. */
export function decodePollVote(params: {
  pollId: string;
  poll: StoredWhatsAppPoll;
  voterJids: string[];
  vote: proto.Message.IPollEncValue;
}): WhatsAppPollVote | undefined {
  const pollEncKey = Buffer.from(params.poll.secret, "base64");
  for (const pollCreatorJid of params.poll.creatorJids) {
    for (const voterJid of params.voterJids) {
      let decrypted: proto.Message.PollVoteMessage;
      try {
        decrypted = decryptPollVote(params.vote, {
          pollCreatorJid,
          pollMsgId: params.pollId,
          pollEncKey,
          voterJid,
        });
      } catch {
        continue;
      }
      const byHash = new Map(params.poll.options.map((name, index) => [optionHash(name), index]));
      const optionIds = (decrypted.selectedOptions ?? [])
        .map((selected) => byHash.get(Buffer.from(selected).toString()))
        .filter((index): index is number => index !== undefined);
      return {
        pollId: params.pollId,
        chatJid: params.poll.chatJid,
        question: params.poll.question,
        optionIds,
        optionNames: optionIds.map((index) => params.poll.options[index] ?? ""),
      };
    }
  }
  return undefined;
}
