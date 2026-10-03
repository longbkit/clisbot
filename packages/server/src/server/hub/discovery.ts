import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HubConnectionSchema, type HubConnection } from "@clisbot/protocol/device-pairing-offer";

const IdentitySchema = HubConnectionSchema.omit({ origin: true });
const GatewaySchema = z.object({
  config: z.object({
    hubOrigin: z.string(),
    origins: z.array(z.string()).max(64),
  }),
});

/** Reads only public metadata from the Host's enrolled origin, never its credential. */
export async function discoverEnrolledHub(
  home: string,
  hubOrigin: string | null,
): Promise<HubConnection | undefined> {
  if (!hubOrigin) return undefined;
  try {
    const response = await fetch(new URL("/api/auth/clisbot/device/identity", hubOrigin), {
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return undefined;
    if (!response.body) return undefined;
    const reader = response.body.getReader();
    let body = "";
    let size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          return undefined;
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const identity = IdentitySchema.parse(JSON.parse(body));
    let origin = portableHttpsOrigin(hubOrigin);
    // A co-located gateway can publish its HTTPS route instead of the Hub's
    // private loopback enrollment address. Otherwise a phone uses relay.
    const gateway = await readFile(path.join(home, "gateway-local.json"), "utf8")
      .then((value) => GatewaySchema.parse(JSON.parse(value)))
      .catch(() => undefined);
    if (gateway?.config.hubOrigin === hubOrigin) {
      origin = gateway.config.origins.map(portableHttpsOrigin).find(Boolean) ?? origin;
    }
    return { ...identity, ...(origin ? { origin } : {}) };
  } catch {
    return undefined;
  }
}

function portableHttpsOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "[::1]" ||
      host.startsWith("127.") ||
      /^\[::ffff:7f[0-9a-f]{2}:/.test(host)
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
