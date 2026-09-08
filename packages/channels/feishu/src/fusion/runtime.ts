// Fusion-owned runtime adapter for `extensions/feishu/src/runtime.ts` (D-FS-013).
//
// Upstream opens SQLite-backed keyed stores from the OpenClaw state directory
// and resolves media through the host's media services, all reached through the
// global plugin runtime store. The Hub owns channel state and media
// authorization in Fusion and exposes one async keyed-store root per account
// (`HostRuntime.state.openKeyedStore`), so this module installs a
// `FeishuPluginRuntime` over it: every ported store keeps its upstream
// interface and call flow. Same adapter shape as the Discord, Telegram and
// Google Chat verticals, plus the media half those three do not need.
//
// The media half is deliberately narrow. `loadWebMedia` and
// `readRemoteMediaBuffer` go through the vertical's own SSRF-guarded fetch
// (`ssrf-fetch.ts`, D-FS-011) with a byte cap enforced while reading, and
// `saveMediaBuffer` writes into the per-account download directory
// `media-resource.ts` owns. Nothing here reaches a daemon workspace: a Project
// file lives on the daemon's machine, not the Hub's.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { HostChildLogger, HostKeyedStore, HostRuntime } from "@getpaseo/channels-shared";
import {
  clearChannelSubsystemLogSink,
  installChannelSubsystemLogSink,
} from "@getpaseo/channels-shared";
import type { PluginRuntime } from "@getpaseo/channels-core/plugin-sdk/channel-core";
import type { PluginStateKeyedStore } from "@getpaseo/channels-core/plugin-sdk/plugin-state-runtime";
import { setVerbose } from "@getpaseo/channels-core/globals";
import { extensionForMime } from "@getpaseo/channels-core/plugin-sdk/media-runtime";
import {
  currentFeishuAccountId,
  setFeishuRuntime,
  type FeishuPluginRuntime,
  type FeishuSavedMediaHandle,
} from "../runtime.js";
import {
  resolveFeishuMediaDownloadDir,
  setFeishuMediaDownloadDir,
  FeishuMediaTooLargeError,
} from "./media-resource.js";
import { fetchWithSsrFGuard } from "./ssrf-fetch.js";

const DEFAULT_MEDIA_READ_TIMEOUT_MS = 30_000;

function toPluginStateKeyedStore<TValue>(
  store: HostKeyedStore<TValue>,
): PluginStateKeyedStore<TValue> {
  return {
    register: (key, value, opts) => store.register(key, value, opts),
    registerIfAbsent: (key, value, opts) => store.registerIfAbsent(key, value, opts),
    update: (key, updateValue, opts) => store.update(key, updateValue, opts),
    lookup: (key) => store.lookup(key),
    consume: (key) => store.consume(key),
    delete: (key) => store.delete(key),
    entries: () => store.entries(),
    clear: () => store.clear(),
  };
}

/** Reads a response body while enforcing `maxBytes`, so an oversized resource
 * is never buffered whole (the same rule `media-resource.ts` follows). */
async function readCappedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new FeishuMediaTooLargeError(maxBytes);
    }
    return buffer;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FeishuMediaTooLargeError(maxBytes);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function readGuarded(params: {
  url: string;
  maxBytes: number;
  timeoutMs?: number;
}): Promise<{ buffer: Buffer; contentType?: string; fileName?: string }> {
  const { response, release } = await fetchWithSsrFGuard({
    url: params.url,
    auditContext: "feishu.media",
    timeoutMs: params.timeoutMs ?? DEFAULT_MEDIA_READ_TIMEOUT_MS,
  });
  try {
    if (!response.ok) {
      throw new Error(`feishu media fetch failed: HTTP ${response.status}`);
    }
    const buffer = await readCappedBody(response, params.maxBytes);
    const contentType = response.headers.get("content-type") ?? undefined;
    const fileName = path.basename(new URL(params.url).pathname) || undefined;
    return {
      buffer,
      ...(contentType === undefined ? {} : { contentType }),
      ...(fileName === undefined ? {} : { fileName }),
    };
  } finally {
    release();
  }
}

async function saveMediaBuffer(
  accountId: string,
  buffer: Buffer,
  contentType: string | undefined,
  direction: "inbound" | "outbound",
  maxBytes: number,
  fileName?: string,
): Promise<FeishuSavedMediaHandle> {
  if (buffer.byteLength > maxBytes) {
    throw new FeishuMediaTooLargeError(maxBytes);
  }
  const dir = path.join(resolveFeishuMediaDownloadDir(accountId), direction);
  await mkdir(dir, { recursive: true });
  const extension = fileName ? path.extname(fileName) : `.${extensionForMime(contentType) ?? "bin"}`;
  const target = path.join(dir, `${randomUUID()}${extension}`);
  await writeFile(target, buffer);
  return {
    path: target,
    ...(contentType === undefined ? {} : { contentType }),
    ...(fileName === undefined ? {} : { fileName }),
  };
}

/** Builds the `FeishuPluginRuntime` the ported stores and media paths read. */
export function createFeishuRuntimeFromHost(
  host: HostRuntime,
  accountId: string,
): FeishuPluginRuntime {
  const state: PluginRuntime["state"] = {
    openKeyedStore<TValue>(options: {
      namespace: string;
      maxEntries?: number;
      defaultTtlMs?: number;
    }) {
      return toPluginStateKeyedStore(
        host.state.openKeyedStore({
          namespace: options.namespace,
          maxEntries: options.maxEntries ?? 1000,
          ...(options.defaultTtlMs === undefined ? {} : { defaultTtlMs: options.defaultTtlMs }),
        }) as HostKeyedStore<TValue>,
      );
    },
  };
  return {
    state,
    media: {
      loadWebMedia: async (url, options) => await readGuarded({ url, maxBytes: options.maxBytes }),
      detectMime: ({ buffer }) => detectMimeFromMagic(buffer),
    },
    channel: {
      media: {
        saveMediaBuffer: (buffer, contentType, direction, maxBytes, fileName) =>
          saveMediaBuffer(accountId, buffer, contentType, direction, maxBytes, fileName),
        readRemoteMediaBuffer: (params) => readGuarded(params),
      },
    },
  };
}

/** The few magic numbers the ported doc-upload path needs to name a blob.
 * Upstream calls the host's full mime sniffer; the Hub has no equivalent
 * service, and a wrong guess here only affects the uploaded file's extension. */
function detectMimeFromMagic(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (buffer.length >= 12 && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF") {
    return "application/pdf";
  }
  return undefined;
}

/** The HostRuntime each account's installed runtime was built from. */
const installedHosts = new Map<string, HostRuntime>();
/** Each account's Hub logger, resolved per line by the channel's sink. */
const accountLoggers = new Map<string, HostChildLogger>();
/**
 * The channel's subsystem log sink: `[feishu/…]` lines go to the logger of
 * the account being served, never to the vertical that booted last
 * (`installChannelSubsystemLogSink`).
 */
function installSubsystemLogSink(): void {
  installChannelSubsystemLogSink({
    channel: "feishu",
    subsystems: ["feishu"],
    loggers: accountLoggers,
    currentAccountId: currentFeishuAccountId,
  });
}

/**
 * Installs the ported channel runtime for one account's host. Safe to call on
 * every send: an account already installed against the same HostRuntime keeps
 * the runtime it has. `accountId` defaults to the unkeyed slot for
 * single-account callers.
 */
export function installFeishuRuntime(
  host: HostRuntime,
  accountId = "",
  mediaDir?: string,
): void {
  accountLoggers.set(
    accountId,
    host.logging.getChildLogger({
      channel: "feishu",
      ...(accountId === "" ? {} : { accountId }),
    }),
  );
  installSubsystemLogSink();
  setVerbose(process.env.OPENCLAW_VERBOSE === "1" || process.env.CLISBOT_VERBOSE === "1");
  if (mediaDir !== undefined) setFeishuMediaDownloadDir(accountId, mediaDir);
  if (installedHosts.get(accountId) === host) return;
  installedHosts.set(accountId, host);
  setFeishuRuntime(createFeishuRuntimeFromHost(host, accountId), accountId);
}

/** Releases one account's ported runtime: its keyed stores, media dir and log
 * sink. Called when the account stops and when its vertical is disposed. */
export function disposeFeishuRuntime(accountId = ""): void {
  installedHosts.delete(accountId);
  accountLoggers.delete(accountId);
  setFeishuMediaDownloadDir(accountId, undefined);
  setFeishuRuntime(undefined, accountId);
  // The last account of this channel is gone: stop owning its subsystems so
  // a line with no logger behind it is not silently swallowed.
  if (accountLoggers.size === 0) clearChannelSubsystemLogSink("feishu");
}
