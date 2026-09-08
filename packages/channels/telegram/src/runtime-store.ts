// The channel's runtime store: holds the Hub's HostRuntime (injected via
// the entry's `setChannelRuntime`) and the per-account L3 inbound processor
// the L4 lifecycle hands its poll events to. One store per channel process;
// the Hub drives one account per vertical instance today, but the map costs
// nothing and keeps multi-account starts from crossing wires.

import type {
  ChannelInboundEvent,
  HostRuntime,
  InboundEventDecision,
} from "@getpaseo/channels-shared";
import { createInboundEventProcessor } from "@getpaseo/channels-shared";
import { disposeTelegramRuntime, installTelegramRuntime } from "./fusion/runtime.js";

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
    throw new Error("telegram channel runtime not set (call entry.setChannelRuntime first)");
  }
  return hostRuntime;
}

/** The L3 processor for one account (created once per (runtime, account));
 * the transport's `onEvent` hands its normalized updates to it.
 *
 * D-TG-046: this is also where the account's ported plugin runtime is
 * installed. The inbound path (polling session offset store, message cache,
 * topic-name cache) resolves its keyed stores through the upstream zero-arg
 * `getTelegramRuntime()`, so an account that only ever receives — no send yet
 * — would otherwise fail every offset persist with "Telegram runtime not
 * initialized". Installing here keeps it symmetric with
 * `unregisterAccountInbound`, which disposes it.
 */
export function registerAccountInbound(
  accountId: string,
  botId?: number,
  runtime: HostRuntime = getHostRuntime(),
): AccountInbound {
  installTelegramRuntime(runtime, accountId);
  let entry = accounts.get(accountId);
  if (entry === undefined || entry.hostRuntime !== runtime) {
    const processor = createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "telegram",
      accountId,
      ...(botId !== undefined ? { botId: String(botId) } : {}),
      logger: runtime.logging.getChildLogger({
        channel: "telegram",
        accountId,
      }),
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
    throw new Error(`telegram account "${accountId}" has no inbound processor (not started?)`);
  }
  return entry;
}

/** Remove only the registration owned by this account lifecycle, and release the
 * ported plugin runtime installed for that account (its keyed stores and log
 * sink) so a stopped account leaves nothing behind for the next one. */
export function unregisterAccountInbound(accountId: string, runtime: HostRuntime): void {
  if (accounts.get(accountId)?.hostRuntime !== runtime) return;
  accounts.delete(accountId);
  disposeTelegramRuntime(accountId);
}
