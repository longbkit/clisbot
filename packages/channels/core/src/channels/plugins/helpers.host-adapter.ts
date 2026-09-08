// Fusion-owned host adapter for `src/channels/plugins/helpers.ts` (D-CORE-044).
//
// Upstream reads the channel's configured accounts out of `config.json` and
// returns the default one (or `DEFAULT_ACCOUNT_ID` when a channel is
// single-account). Fusion's Hub owns Connections and names the account on every
// call, so "no configured default" is the honest answer here.
export function resolveChannelDefaultAccountId(_params: {
  plugin?: unknown;
  cfg: unknown;
}): string | undefined {
  return undefined;
}
