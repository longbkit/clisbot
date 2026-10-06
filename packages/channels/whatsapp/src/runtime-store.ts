// The channel's runtime store: the Hub's HostRuntime (injected through the
// entry's `setChannelRuntime`) and the per-account L3 inbound processor the
// account lifecycle hands its events to. Mirrors the Zalo Personal, Google Chat,
// Discord and Telegram verticals' `runtime-store.ts`.
//
// Loading this module also installs the WhatsApp plugin runtime upstream's
// connection controller publishes itself into (`fusion/plugin-runtime.ts`), so
// the ported send path can find a live socket by account.
import type {
  ChannelInboundEvent,
  HostRuntime,
  InboundEventDecision,
} from "@clisbot/channels-shared";
import { createInboundEventProcessor } from "@clisbot/channels-shared";
import { createWhatsAppPluginRuntime } from "./fusion/plugin-runtime.js";
import { getOptionalWhatsAppRuntime, setWhatsAppRuntime } from "./runtime.js";

if (getOptionalWhatsAppRuntime() === null) setWhatsAppRuntime(createWhatsAppPluginRuntime());

interface AccountInbound {
  hostRuntime: HostRuntime;
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
    throw new Error("whatsapp channel runtime not set (call entry.setChannelRuntime first)");
  }
  return hostRuntime;
}

/**
 * The runtime each account was started or set up with. The Hub imports this
 * vertical once per channel and every account load overwrites the channel-wide
 * slot above, so that slot is whichever account loaded last: anything that reads
 * or writes ONE account's credentials resolves its runtime here instead.
 */
const accountRuntimes = new Map<string, HostRuntime>();

/** The account was unloaded: its runtime (and the backing behind it) is gone. */
export function forgetAccountHostRuntime(accountId: string): void {
  accountRuntimes.delete(accountId);
}

/** Remember the runtime an account's credentials live behind. */
export function rememberAccountHostRuntime(accountId: string, runtime: HostRuntime): void {
  accountRuntimes.set(accountId, runtime);
}

/**
 * One account's own HostRuntime: the one the Hub passed with the call, else the
 * one the account started with. Never the channel-wide slot — with two accounts
 * it would point a login or a logout at the other account's keys.
 */
export function accountHostRuntime(accountId: string, passed?: HostRuntime): HostRuntime {
  const runtime = passed ?? accountRuntimes.get(accountId);
  if (runtime === undefined) {
    throw new Error(`whatsapp account "${accountId}" has no host runtime yet; start the account first`);
  }
  if (passed !== undefined) accountRuntimes.set(accountId, passed);
  return runtime;
}

/** The L3 processor for one account, created once per (runtime, account). */
export function registerAccountInbound(
  accountId: string,
  runtime: HostRuntime = getHostRuntime(),
): AccountInbound {
  let entry = accounts.get(accountId);
  if (entry === undefined || entry.hostRuntime !== runtime) {
    const processor = createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "whatsapp",
      accountId,
      logger: runtime.logging.getChildLogger({ channel: "whatsapp", accountId }),
    });
    entry = { hostRuntime: runtime, handleInbound: (event) => processor.process(event) };
    accounts.set(accountId, entry);
  }
  return entry;
}

/** Remove only the registration owned by this account lifecycle. */
export function unregisterAccountInbound(accountId: string, runtime: HostRuntime): void {
  if (accounts.get(accountId)?.hostRuntime !== runtime) return;
  accounts.delete(accountId);
}
