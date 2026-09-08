// upstream: src/plugin-sdk/fetch-runtime.ts@5d8067a4483
// Fetch helpers for plugin transports.
export { responseWithRelease } from "../infra/net/guarded-body-stream.js";
// D-CORE-217: the upstream barrel also re-exports the SSRF fetch guard, the
// pinned dispatcher pool, the proxy-env resolvers, `makeProxyFetch` and the
// undici runtime helpers from `src/infra/net/*` (about 11k lines wired to
// OpenClaw's global dispatcher and net policy). Fusion channel transports own
// their own fetch stack, so only the body-release helper the Telegram client
// fetch imports is carried; see the Telegram manifest D-TG-013.

// Slice 13 addition (Discord vertical port): the ported Discord API/probe clients
// call `resolveFetch`, upstream's `src/infra/fetch.ts` wrapper that relays an
// options abort signal onto the injected fetch. Carried verbatim with its
// header-normalization dependency. `makeProxyFetch` stays omitted: Discord's own
// `proxy-fetch.ts` is the vertical's proxy seam (D-DC-006).
export { resolveFetch, wrapFetchWithAbortSignal } from "../infra/fetch.js";
