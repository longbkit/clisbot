import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createHttp1EnvHttpProxyAgent, createHttp1ProxyAgent, createNodeProxyAgent, resolveEnvProxyForTarget } from "./proxy-agents.js";

const WA_TARGET = "https://mmg.whatsapp.net/";
const PROXY_KEYS = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "no_proxy", "NO_PROXY"] as const;
const saved = Object.fromEntries(PROXY_KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof PROXY_KEYS)[number], string>>) {
  for (const key of PROXY_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

afterEach(() => {
  for (const key of PROXY_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("fusion proxy agents (upstream env-proxy semantics)", () => {
  it("connects directly when no proxy is configured", () => {
    setEnv({});
    expect(createNodeProxyAgent({ mode: "env", targetUrl: WA_TARGET, protocol: "https" })).toBeUndefined();
  });

  it("prefers lowercase https_proxy, falls back to http_proxy, and honours NO_PROXY", () => {
    setEnv({ https_proxy: "http://lower:1", HTTPS_PROXY: "http://upper:2" });
    expect(resolveEnvProxyForTarget(WA_TARGET)).toBe("http://lower:1");
    setEnv({ HTTP_PROXY: "http://only-http:3" });
    expect(resolveEnvProxyForTarget(WA_TARGET)).toBe("http://only-http:3");
    setEnv({ HTTPS_PROXY: "http://proxy:4", NO_PROXY: ".whatsapp.net" });
    expect(resolveEnvProxyForTarget(WA_TARGET)).toBeUndefined();
  });

  it("refuses a SOCKS proxy with upstream's message", () => {
    setEnv({ HTTPS_PROXY: "socks5://127.0.0.1:1080" });
    expect(() => createNodeProxyAgent({ mode: "env", targetUrl: WA_TARGET })).toThrow(/SOCKS and PAC/);
    expect(() => createHttp1ProxyAgent({ uri: "socks5://127.0.0.1:1080" })).toThrow(/SOCKS and PAC/);
  });

  it("tunnels the WhatsApp connection through the proxy with CONNECT", async () => {
    const seen: string[] = [];
    const proxy = http.createServer();
    proxy.on("connect", (req, socket) => {
      seen.push(`${req.method} ${req.url}`);
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const { port } = proxy.address() as AddressInfo;
    try {
      setEnv({ HTTPS_PROXY: `http://127.0.0.1:${port}` });
      const agent = createNodeProxyAgent({ mode: "env", targetUrl: WA_TARGET });
      expect(agent?.proxy.toString()).toBe(`http://127.0.0.1:${port}/`);
      await new Promise<void>((resolve) => {
        https.get("https://web.whatsapp.com/ws/chat", { agent }, () => resolve()).on("error", () => resolve());
      });
      expect(seen).toEqual(["CONNECT web.whatsapp.com:443"]);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });

  it("builds undici dispatchers for media uploads", () => {
    expect(createHttp1ProxyAgent({ uri: "http://127.0.0.1:3128" }).constructor.name).toBe("ProxyAgent");
    expect(createHttp1EnvHttpProxyAgent().constructor.name).toBe("EnvHttpProxyAgent");
  });
});
