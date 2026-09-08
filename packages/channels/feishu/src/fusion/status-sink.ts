// Fusion-owned home for the status-sink contract upstream declares in
// `extensions/feishu/src/monitor.ts` (D-FS-003).
//
// `monitor.ts` is OpenClaw's multi-account monitor driver: it resolves every
// enabled account out of the process config and fans out to
// `monitor.account.ts`, which owns the agent reply engine (`bot.ts`,
// `reply-dispatcher.ts`). The Hub owns account lifecycle and agent routing in
// Fusion, so that file is omitted (upstream-sync.json `omitted`) and the ported
// transport's one import from it — the status-sink type — lives here with
// upstream's text.

/**
 * Function shape for partial channel status patches with a bound accountId.
 * Mirrors the return type of `createAccountStatusSink` from the plugin SDK
 * so the feishu plugin does not need to depend on a specific channel runtime.
 *
 * We use a structural Partial<{...}> to keep the sink type lightweight and
 * decoupled from the ChannelAccountSnapshot type. The runtime accepts any
 * subset of these fields.
 */
export type FeishuStatusSink = (patch: {
  connected?: boolean;
  lifecycle?: "ready" | "recovering" | "blocked";
  terminalDisconnect?: boolean;
  lastConnectedAt?: number | null;
  lastEventAt?: number | null;
  lastTransportActivityAt?: number | null;
  lastError?: string | null;
}) => void;
