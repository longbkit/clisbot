import type {
  ChannelPairingAccessContract,
  DirectMessagePolicy,
  PairingAccessSubject,
} from "./access-contract.ts";
import type { PairingChannel } from "./store.ts";
import { CHANNEL_PAIRING_ACCESS_CONTRACTS } from "../integration/channel-installation-inventory.ts";

function requirePairingAccessContract(channel: PairingChannel) {
  const contract = CHANNEL_PAIRING_ACCESS_CONTRACTS.find((entry) => entry.channel === channel);
  if (!contract) {
    throw new Error(`Unsupported channel pairing access contract: ${channel}`);
  }
  return contract;
}

export function normalizeAllowEntry(channel: PairingChannel, entry: string) {
  return requirePairingAccessContract(channel).normalizeAllowEntry(entry);
}

export function normalizeApprovedPairingId(channel: PairingChannel, id: string) {
  return requirePairingAccessContract(channel).normalizeApprovedPairingId(id);
}

export function isChannelSenderAllowed(params: {
  channel: PairingChannel;
  allowFrom: string[];
  subject: PairingAccessSubject;
}) {
  return requirePairingAccessContract(params.channel).isSenderAllowed(params);
}

export function isChannelSenderBlocked(params: {
  channel: PairingChannel;
  blockFrom: string[];
  subject: PairingAccessSubject;
}) {
  return isChannelSenderAllowed({
    channel: params.channel,
    allowFrom: params.blockFrom,
    subject: params.subject,
  });
}

export type { DirectMessagePolicy, PairingAccessSubject };
