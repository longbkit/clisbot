// The channel's runtime store: holds the Hub's HostRuntime (injected via the
// entry's `setChannelRuntime`) and the per-account L3 inbound processor the L4
// lifecycle hands its messages to. One store per channel process; the Hub drives
// one account per vertical instance today, but the map costs nothing and keeps
// multi-account starts from crossing wires. Mirrors the Google Chat, Discord, Zalo and
// Telegram verticals' `runtime-store.ts`.

import type {
  ChannelInboundEvent,
  HostRuntime,
  InboundEventDecision,
} from "@getpaseo/channels-shared";
import { createInboundEventProcessor } from "@getpaseo/channels-shared";

interface AccountInbound {
  hostRuntime: HostRuntime;
  processor: {
    process(event: ChannelInboundEvent): Promise<InboundEventDecision>;
  };
  handleInbound(event: ChannelInboundEvent): Promise<InboundEventDecision>;
}

let hostRuntime: HostRuntime | undefined;
const accounts = new Map<string, AccountInbound>();

/** Fill the store (the entry's `setChannelRuntime` delegates here). */
export function setChannelHostRuntime(runtime: HostRuntime): void {
  hostRuntime = runtime;
}

/** The stored HostRuntime; throws when driven before `setChannelRuntime`. */
export function getHostRuntime(): HostRuntime {
  if (hostRuntime === undefined) {
    throw new Error("zalouser channel runtime not set (call entry.setChannelRuntime first)");
  }
  return hostRuntime;
}

/** The L3 processor for one account (created once per (runtime, account)); both
 * sessions' admission hands its normalized events to it. */
export function registerAccountInbound(
  accountId: string,
  /** The linked account's own Zalo user id — the processor's own-message filter. */
  botId?: string,
  runtime: HostRuntime = getHostRuntime(),
): AccountInbound {
  let entry = accounts.get(accountId);
  if (entry === undefined || entry.hostRuntime !== runtime) {
    const processor = createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "zalouser",
      accountId,
      ...(botId !== undefined ? { botId } : {}),
      logger: runtime.logging.getChildLogger({ channel: "zalouser", accountId }),
    });
    entry = {
      hostRuntime: runtime,
      processor,
      handleInbound: (event) => processor.process(event),
    };
    accounts.set(accountId, entry);
  }
  return entry;
}

/** The account's inbound handler (throws when the account never started). */
export function getAccountRuntime(accountId: string): AccountInbound {
  const entry = accounts.get(accountId);
  if (entry === undefined) {
    throw new Error(`zalouser account "${accountId}" has no inbound processor (not started?)`);
  }
  return entry;
}

/** Remove only the registration owned by this account lifecycle. */
export function unregisterAccountInbound(accountId: string, runtime: HostRuntime): void {
  if (accounts.get(accountId)?.hostRuntime !== runtime) return;
  accounts.delete(accountId);
}
