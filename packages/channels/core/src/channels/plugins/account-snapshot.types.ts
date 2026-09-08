// Fusion-owned boundary for the `ChannelAccountSnapshot` half of
// `src/channels/plugins/types.core.ts` (D-CORE-241).
//
// Upstream declares it inside the plugin type universe the port stops at
// (D-CORE-010). `account-helpers.ts` returns it from `describeAccountSnapshot`,
// so the shape is carried here with upstream's field names and doc comments,
// plus an open index signature for the status fields the Hub does not read.
export type ChannelAccountSnapshot = {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  statusState?: string;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
  lastError?: string | null;
  /** Recorded account lifecycle, independent of inferred transport health. */
  lifecycle?: "starting" | "ready" | "recovering" | "blocked" | "stopped";
  [key: string]: unknown;
};
