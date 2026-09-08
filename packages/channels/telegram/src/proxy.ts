// upstream: extensions/telegram/src/proxy.ts@5d8067a4483
// D-TG-013: upstream re-exports the OpenClaw proxy fetch factory
// (`openclaw/plugin-sdk/fetch-runtime` -> `src/infra/net/proxy-fetch.ts`), which
// pulls the SSRF guard, the pinned dispatcher pool and the global undici
// dispatcher. Fusion's Telegram transport owns its own fetch stack
// (`./fetch.ts`), so a proxy fetch is a `ProxyAgent`-backed undici fetch and the
// proxy URL is tracked on the returned function.
const PROXY_URL = Symbol.for("openclaw.telegramProxyFetchUrl");

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
