// upstream: extensions/discord/src/proxy-fetch.ts@5d8067a4483
// D-DC-006: upstream imports `makeProxyFetch` from
// `openclaw/plugin-sdk/fetch-runtime` -> `src/infra/net/proxy-fetch.ts`, which
// pulls the SSRF guard, the pinned dispatcher pool and OpenClaw's global undici
// dispatcher. The Discord transport owns its own fetch stack, so the proxy fetch
// is a `ProxyAgent`-backed undici fetch declared here — the same shape the
// Telegram vertical ships (D-TG-013). Theme formatters come from
// `./fusion/runtime-env.js` (D-DC-005).
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { danger } from "./fusion/runtime-env.js";
import type { RuntimeEnv } from "@getpaseo/channels-core/plugin-sdk/runtime-env";

const PROXY_URL = Symbol.for("openclaw.discordProxyFetchUrl");

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
import { normalizeOptionalString } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";
import type { ResolvedDiscordAccount } from "./accounts.js";

function resolveDiscordProxyUrl(
  account: Pick<ResolvedDiscordAccount, "config">,
  cfg: OpenClawConfig,
): string | undefined {
  const accountProxy = normalizeOptionalString(account.config.proxy);
  if (accountProxy) {
    return accountProxy;
  }
  return normalizeOptionalString(cfg?.channels?.discord?.proxy);
}

function resolveDiscordProxyFetchByUrl(
  proxyUrl: string | undefined,
  runtime?: Pick<RuntimeEnv, "error">,
): typeof fetch | undefined {
  return withValidatedDiscordProxy(proxyUrl, runtime, (proxy) => makeProxyFetch(proxy));
}

export function resolveDiscordProxyFetchForAccount(
  account: Pick<ResolvedDiscordAccount, "config">,
  cfg: OpenClawConfig,
  runtime?: Pick<RuntimeEnv, "error">,
): typeof fetch | undefined {
  return resolveDiscordProxyFetchByUrl(resolveDiscordProxyUrl(account, cfg), runtime);
}

export function withValidatedDiscordProxy<T>(
  proxyUrl: string | undefined,
  runtime: Pick<RuntimeEnv, "error"> | undefined,
  createValue: (proxyUrl: string) => T,
): T | undefined {
  const proxy = proxyUrl?.trim();
  if (!proxy) {
    return undefined;
  }
  try {
    validateDiscordProxyUrl(proxy);
    return createValue(proxy);
  } catch (err) {
    runtime?.error?.(danger(`discord: invalid rest proxy: ${String(err)}`));
    return undefined;
  }
}

export function validateDiscordProxyUrl(proxyUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new Error("Proxy URL must be a valid http or https URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Proxy URL must use http or https");
  }
  if (!parsed.hostname) {
    throw new Error("Proxy URL must include a host");
  }
  return proxyUrl;
}
