// Fusion-owned media boundary for the ported Slack inbound-media reader
// (D-031). It stands in for `openclaw/plugin-sdk/runtime-fetch` and
// `openclaw/plugin-sdk/media-runtime` in `monitor/media.runtime.ts`.
//
// Upstream downloads a Slack file through the runtime dispatcher (pinned DNS,
// global undici agent) and hands the bytes to `saveRemoteMedia`, which writes
// them into OpenClaw's media store and returns a store-relative path. Fusion's
// Hub owns media staging: the vertical downloads into memory and the caller
// stages the buffer. `saveRemoteMedia` therefore fails loudly rather than
// silently writing somewhere the Hub does not know about; it lands with the
// host media-staging slice (goal ledger slice 20).

/** Upstream's fetch-shaped injection point. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Upstream pins the dispatcher per request; Fusion uses the process fetch. */
export const fetchWithRuntimeDispatcher: FetchLike = (input, init) => fetch(input, init);

/** Upstream's staged-media record: a store path plus the sniffed metadata. */
export type SavedRemoteMedia = {
  path: string;
  contentType?: string;
  fileName?: string;
  bytes?: number;
};

/** Upstream's staging request: a URL plus the transport/limit policy. */
export type SaveRemoteMediaOptions = {
  url: string;
  fetchImpl?: FetchLike;
  requestInit?: RequestInit;
  maxBytes?: number;
  readIdleTimeoutMs?: number;
  [key: string]: unknown;
};

/** Not available until the Hub exposes a media staging root. */
export function saveRemoteMedia(_params: SaveRemoteMediaOptions): Promise<SavedRemoteMedia> {
  return Promise.reject(
    new Error(
      "Slack media staging has no Hub seam yet: saveRemoteMedia lands with the host media-staging slice.",
    ),
  );
}
