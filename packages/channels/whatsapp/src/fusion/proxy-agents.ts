// Fusion-owned proxy agents for `session.ts` (D-WA-016).
//
// Upstream routes the WhatsApp WebSocket and the media uploads through an
// ambient `HTTPS_PROXY`/`HTTP_PROXY`. Its helpers wrap OpenClaw's internal
// `@openclaw/proxyline` (WebSocket) and an undici dispatcher stack (uploads);
// the port may not depend on OpenClaw internals, so the same three entry points
// are built on the public libraries that do the same job:
//
//  * `createNodeProxyAgent({ mode: "env", targetUrl })` → an `https-proxy-agent`
//    `HttpsProxyAgent` (the agent Baileys documents for its WebSocket), or
//    nothing when no proxy applies. Which proxy applies — lowercase variables
//    first, HTTPS falling back to HTTP, `NO_PROXY` honored — is upstream's own
//    `resolveEnvHttpProxyUrl` / `matchesNoProxy` (core `infra/net/proxy-env.ts`,
//    verbatim).
//    SOCKS and PAC URLs are refused with upstream's message; `session.ts` logs
//    that and connects directly, which is upstream's own fallback.
//  * `createHttp1ProxyAgent({ uri })` / `createHttp1EnvHttpProxyAgent()` →
//    undici's `ProxyAgent` / `EnvHttpProxyAgent`, the dispatchers upstream's own
//    helpers return, for Baileys' media fetches.
//
// `session.ts` (upstream, unchanged apart from this import) still decides when
// each is used and reads the agent's `proxy` URL back for the upload dispatcher.
import { HttpsProxyAgent } from "https-proxy-agent";
import {
  matchesNoProxy,
  resolveEnvHttpProxyUrl,
} from "@clisbot/channels-core/plugin-sdk/fetch-runtime";
import { EnvHttpProxyAgent, ProxyAgent } from "undici";

const UNSUPPORTED_PROXY_PROTOCOL_MESSAGE =
  "Unsupported proxy protocol. SOCKS and PAC proxy URLs are not supported; use an HTTP or HTTPS proxy URL.";

function assertHttpProxy(proxyUrl: string): void {
  const protocol = new URL(proxyUrl).protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(UNSUPPORTED_PROXY_PROTOCOL_MESSAGE);
  }
}

/** The env proxy for a target, or undefined when none applies (`NO_PROXY`). */
export function resolveEnvProxyForTarget(
  targetUrl: string | URL,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const url = new URL(String(targetUrl));
  const protocol = url.protocol === "http:" || url.protocol === "ws:" ? "http" : "https";
  if (matchesNoProxy(url.toString(), env)) return undefined;
  return resolveEnvHttpProxyUrl(protocol, env);
}

export function createNodeProxyAgent(params: {
  mode: "env";
  targetUrl: string | URL;
  protocol?: "https" | "http";
}): HttpsProxyAgent<string> | undefined {
  const proxyUrl = resolveEnvProxyForTarget(params.targetUrl);
  if (proxyUrl === undefined) return undefined;
  assertHttpProxy(proxyUrl);
  return new HttpsProxyAgent(proxyUrl);
}

export function createHttp1ProxyAgent(params: { uri: string }): ProxyAgent {
  assertHttpProxy(params.uri);
  return new ProxyAgent({ uri: params.uri });
}

export function createHttp1EnvHttpProxyAgent(): EnvHttpProxyAgent {
  return new EnvHttpProxyAgent();
}
