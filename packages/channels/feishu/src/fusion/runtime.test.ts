import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostRuntime } from "@getpaseo/channels-shared";
import { getFeishuRuntime } from "../runtime.js";
import { disposeFeishuRuntime, installFeishuRuntime } from "./runtime.js";
import { setGuardedFetchImplementation } from "./ssrf-fetch.js";

const ACCOUNT = "media-test";
let dir: string;

function stubHostRuntime(): HostRuntime {
  const stores = new Map<string, Map<string, unknown>>();
  return {
    onInboundReply: async () => ({ delivered: false }),
    state: {
      openKeyedStore: ({ namespace }: { namespace: string }) => {
        const store = stores.get(namespace) ?? new Map<string, unknown>();
        stores.set(namespace, store);
        return {
          register: async (key: string, value: unknown) => void store.set(key, value),
          registerIfAbsent: async (key: string, value: unknown) =>
            store.has(key) ? undefined : void store.set(key, value),
          update: async () => undefined,
          lookup: async (key: string) => store.get(key),
          consume: async (key: string) => {
            const value = store.get(key);
            store.delete(key);
            return value;
          },
          delete: async (key: string) => void store.delete(key),
          entries: async () => [...store.entries()],
          clear: async () => store.clear(),
        };
      },
    },
    logging: { getChildLogger: () => ({}) },
    channel: {},
  } as unknown as HostRuntime;
}

function fakeFetch(bytes: number, contentType = "image/png"): typeof globalThis.fetch {
  return (async () =>
    new Response(Buffer.alloc(bytes, 1), {
      status: 200,
      headers: { "content-type": contentType },
    })) as unknown as typeof globalThis.fetch;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "feishu-media-"));
  installFeishuRuntime(stubHostRuntime(), ACCOUNT, dir);
});

afterEach(async () => {
  setGuardedFetchImplementation(undefined);
  disposeFeishuRuntime(ACCOUNT);
  await rm(dir, { recursive: true, force: true });
});

describe("installFeishuRuntime media boundary", () => {
  it("reads a remote resource within the cap", async () => {
    setGuardedFetchImplementation(fakeFetch(1024));
    const runtime = getFeishuRuntime(ACCOUNT);
    const result = await runtime.channel.media.readRemoteMediaBuffer({
      url: "https://open.feishu.cn/media/a.png",
      maxBytes: 4096,
    });
    expect(result.buffer.byteLength).toBe(1024);
    expect(result.contentType).toBe("image/png");
  });

  it("refuses a resource over the cap instead of buffering it", async () => {
    setGuardedFetchImplementation(fakeFetch(8192));
    const runtime = getFeishuRuntime(ACCOUNT);
    await expect(
      runtime.channel.media.readRemoteMediaBuffer({
        url: "https://open.feishu.cn/media/big.png",
        maxBytes: 4096,
      }),
    ).rejects.toThrow(/exceeds the configured limit/);
  });

  it("applies the same cap to loadWebMedia", async () => {
    setGuardedFetchImplementation(fakeFetch(8192));
    const runtime = getFeishuRuntime(ACCOUNT);
    await expect(
      runtime.media.loadWebMedia("https://open.feishu.cn/media/big.png", { maxBytes: 1024 }),
    ).rejects.toThrow(/exceeds the configured limit/);
  });

  it("writes a saved buffer under the account's download directory", async () => {
    const runtime = getFeishuRuntime(ACCOUNT);
    const saved = await runtime.channel.media.saveMediaBuffer(
      Buffer.from("payload"),
      "image/png",
      "inbound",
      1024,
      "shot.png",
    );
    expect(saved.path.startsWith(path.join(dir, "inbound"))).toBe(true);
    expect(await readFile(saved.path, "utf8")).toBe("payload");
  });

  it("refuses to save a buffer over the cap", async () => {
    const runtime = getFeishuRuntime(ACCOUNT);
    await expect(
      runtime.channel.media.saveMediaBuffer(Buffer.alloc(2048), "image/png", "inbound", 1024),
    ).rejects.toThrow(/exceeds the configured limit/);
  });

  it("detects the mime of a PNG buffer without the host sniffer", async () => {
    const runtime = getFeishuRuntime(ACCOUNT);
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    expect(await runtime.media.detectMime({ buffer: png })).toBe("image/png");
  });
});
