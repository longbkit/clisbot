# Seam result + process limits

## No double-post (the seam result shape)

The bound seam returns the conservative result `{dispatched: true, dispatchResult: {queuedFinal: false, counts: {}}}` from `hosts/channel-inbound.ts` → the OpenClaw pipeline clears its draft stream and never posts its own final message; the Hub relay's PostFn (`outbound.md`) is the only post path, deduped by the delivery ledger. On a dispatch fault (or a missing runtime) the seam returns `{dispatched: false}` and never throws into the channel (P13).

## One account per channel per process

The plugin runtime store is a process-global registry on `globalThis` keyed `plugin-runtime:<pluginId>`; the last `setSlackRuntime` / `setTelegramRuntime` wins and there is one slot per channel per process. P0 runs one account per channel; multi-account per channel is P1 (separate Hub processes or a registry change). The loader's `dispose()` clears the account's runtime-store entry and forgets the lifetime routing registration, but the process-wide hooks stay registered for the other loaded accounts.
