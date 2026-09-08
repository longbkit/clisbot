// Fusion-owned boundary for `openclaw/plugin-sdk/fetch-runtime` (D-ZL-005).
//
// Upstream's `makeProxyFetch` (`src/infra/net/proxy-fetch.ts`) pulls the SSRF
// fetch guard, the pinned-dispatcher pool and OpenClaw's global undici
// dispatcher. Fusion channel transports own their own fetch stack, so the proxy
// fetch is a `ProxyAgent`-backed undici fetch declared here — the same shape the
// Discord vertical ships (D-DC-006) and the Telegram one before it (D-TG-013).
// The ported `proxy.ts` keeps its cache and its call shape.
const PROXY_URL = Symbol.for("openclaw.zaloProxyFetchUrl");

type ProxyTaggedFetch = typeof fetch & { [PROXY_URL]?: string };

/** Builds a fetch bound to `proxyUrl`. */
export function makeProxyFetch(proxyUrl: string): typeof fetch {
  const tagged: ProxyTaggedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { ProxyAgent } = (await import("undici")) as unknown as {
      ProxyAgent: new (url: string) => unknown;
    };
    const dispatcher = new ProxyAgent(proxyUrl);
    return await fetch(input, { ...init, dispatcher } as RequestInit);
  }) as ProxyTaggedFetch;
  tagged[PROXY_URL] = proxyUrl;
  return tagged;
}

/** The proxy URL a `makeProxyFetch` result was built with, when known. */
export function getProxyUrlFromFetch(fetchImpl?: typeof fetch): string | undefined {
  return (fetchImpl as ProxyTaggedFetch | undefined)?.[PROXY_URL];
}
