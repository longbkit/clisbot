// The Hub's outbound media stager (slice 11b of
// docs/audits/2026-09-07-openclaw-channel-port-goal.md).
//
// Upstream reaches files through OpenClaw's media store: a process-wide media
// directory the agent, the gateway and the channel plugins all share. Fusion has
// no such store, so core's media host adapters (D-CORE-053/055/056/059) failed
// loudly and no file could reach a channel at all. This
// module is the implementation behind them: it turns the four media sources the
// upstream `message` tool accepts — a local path, a `data:` URL, an `http(s)`
// URL, and inline base64 `buffer` bytes — into one absolute local file a
// vertical's `outbound.sendMedia` can upload.
//
// Authority is the reply capability's Project root, not the model's argument.
// The containment check is realpath on BOTH
// sides, so a symlink inside the Project cannot point out of it. Size is the
// channel's own outbound cap from `@getpaseo/channels-shared`. A remote URL is
// model-authored input and goes through the shared SSRF guard, which refuses
// private hosts and refuses to follow a redirect.
//
// A stager is built per call and installed in an `AsyncLocalStorage` scope
// alongside the outbound sender (the R1 pattern): one Hub serves many
// organizations, and each call stages under its own Project root and its own
// channel cap, so a process-global stager would let a later call write through
// an earlier call's boundary.

import { randomUUID } from "node:crypto";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  evaluateOutboundMedia,
  fetchRemoteMedia,
  mediaFileName,
  mediaMaxBytesForChannel,
  RemoteMediaRefusedError,
  type MediaChannel,
} from "@getpaseo/channels-shared";
import { detectMime, FILE_TYPE_SNIFF_MAX_BYTES } from "@getpaseo/channels-core/media-core/mime";
import { runWithMediaBufferStager } from "@getpaseo/channels-core/media/store.host-adapter";

/** One media source as the upstream `message` tool spells it. */
export interface ChannelMediaSource {
  /** A local absolute path, a `file:`/`data:` URL, or an `http(s)` URL. */
  media?: string | undefined;
  /** Base64 or data-URL bytes when the model inlined the file. */
  buffer?: string | undefined;
  fileName?: string | undefined;
  mimeType?: string | undefined;
  /** Send an audio file as a voice note where the channel has one. */
  asVoice?: boolean | undefined;
}

/** A file staged under the Hub's control, ready for a vertical's `sendMedia`. */
export interface StagedChannelMedia {
  filePath: string;
  fileName: string;
  mimeType?: string | undefined;
  sizeBytes: number;
  asVoice?: boolean | undefined;
  /** Removes bytes the stager wrote; absent for a file already in the Project. */
  release?: (() => Promise<void>) | undefined;
}

/** Stages one media source, or throws `ChannelMediaRefusedError`. */
export type ChannelMediaStager = (source: ChannelMediaSource) => Promise<StagedChannelMedia>;

/** A media source the Hub will not stage. The message is the model's answer. */
export class ChannelMediaRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelMediaRefusedError";
  }
}

export interface ChannelMediaStagerOptions {
  channel: MediaChannel;
  /** The reply capability's Project root; absent means no local file may be read. */
  projectRoot?: string | undefined;
  /** Where staged bytes are written. Defaults to a per-process temp directory. */
  stagingRoot?: string | undefined;
  /** Test seams for the guarded remote read. */
  fetchImpl?: typeof globalThis.fetch | undefined;
  lookupImpl?: Parameters<typeof fetchRemoteMedia>[0]["lookupImpl"] | undefined;
}

const DATA_URL = /^data:([^;,]*)(;base64)?,/i;
const REMOTE_URL = /^https?:\/\//i;

/**
 * Resolves a model-supplied path against the capability's Project root.
 *
 * Containment is checked AFTER symlink resolution on both sides: a lexical
 * check would let a link inside the Project escape to a target outside it, and
 * the canonical path is what gets uploaded.
 */
export function resolveProjectFile(
  projectRoot: string | undefined,
  filePath: string,
): { path: string; sizeBytes: number } {
  if (projectRoot === undefined) {
    throw new ChannelMediaRefusedError(
      "file sending is unavailable for this session: no Project root is configured",
    );
  }
  if (!path.isAbsolute(filePath)) {
    throw new ChannelMediaRefusedError("path must be an absolute path (e.g. /home/.../report.md)");
  }
  let root: string;
  try {
    root = realpathSync(projectRoot);
  } catch {
    throw new ChannelMediaRefusedError(
      "file sending is unavailable for this session: the Project root does not exist",
    );
  }
  let target: string;
  try {
    target = realpathSync(filePath);
  } catch {
    throw new ChannelMediaRefusedError(`file not found: ${filePath}`);
  }
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new ChannelMediaRefusedError("path is outside the allowed Project root");
  }
  let sizeBytes: number;
  try {
    const stats = statSync(target);
    if (!stats.isFile()) throw new ChannelMediaRefusedError("not a regular file");
    sizeBytes = stats.size;
  } catch (error) {
    if (error instanceof ChannelMediaRefusedError) throw error;
    throw new ChannelMediaRefusedError(`file not found: ${filePath}`);
  }
  return { path: target, sizeBytes };
}

/** Refuses a file the channel cannot upload; the wording is the shared G11 notice. */
function assertWithinChannelCap(params: {
  channel: MediaChannel;
  sizeBytes: number;
  fileName: string;
}): void {
  const decision = evaluateOutboundMedia({
    sizeBytes: params.sizeBytes,
    channel: params.channel,
    fileName: params.fileName,
  });
  if (!decision.ok) throw new ChannelMediaRefusedError(decision.notice);
}

/** Decodes inline bytes; accepts a bare base64 string and a `data:` URL alike. */
function decodeInlineMedia(value: string): { buffer: Buffer; mimeType?: string } {
  const dataUrl = DATA_URL.exec(value);
  if (dataUrl === null) {
    const buffer = Buffer.from(value, "base64");
    if (buffer.byteLength === 0) {
      throw new ChannelMediaRefusedError("buffer is not valid base64 content");
    }
    return { buffer };
  }
  const body = value.slice(dataUrl[0].length);
  const buffer = Buffer.from(body, dataUrl[2] === undefined ? "utf8" : "base64");
  const mimeType = dataUrl[1]?.trim();
  return { buffer, ...(mimeType ? { mimeType } : {}) };
}

/** The first megabyte of a local file, for MIME sniffing without reading it whole. */
async function readSniffPrefix(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(FILE_TYPE_SNIFF_MAX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, FILE_TYPE_SNIFF_MAX_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** The per-call staging context every branch below shares. */
interface StagerContext {
  channel: MediaChannel;
  projectRoot?: string | undefined;
  maxBytes: number;
  stagingRoot: string;
  fetchImpl?: typeof globalThis.fetch | undefined;
  lookupImpl?: Parameters<typeof fetchRemoteMedia>[0]["lookupImpl"] | undefined;
  /**
   * Files this stager wrote, by absolute path.
   *
   * Core stages inline `buffer` bytes itself, through the media host adapter
   * this same stager backs, and then rewrites the send's params to the staged
   * PATH. So the send's own staging step is handed a path this call just
   * created — under the staging root, not under the Project — and must
   * recognize its own output instead of refusing it as an escape.
   */
  written: Map<string, StagedChannelMedia>;
}

/** Writes bytes into the call's staging directory and sniffs their MIME. */
async function stageBytes(
  context: StagerContext,
  params: {
    buffer: Buffer;
    fileName: string;
    headerMime?: string | undefined;
    asVoice?: boolean | undefined;
  },
): Promise<StagedChannelMedia> {
  assertWithinChannelCap({
    channel: context.channel,
    sizeBytes: params.buffer.byteLength,
    fileName: params.fileName,
  });
  const directory = path.join(context.stagingRoot, randomUUID());
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, params.fileName);
  await writeFile(filePath, params.buffer);
  const mimeType = await detectMime({
    buffer: params.buffer,
    filePath,
    ...(params.headerMime === undefined ? {} : { headerMime: params.headerMime }),
  });
  const staged: StagedChannelMedia = {
    filePath,
    fileName: params.fileName,
    sizeBytes: params.buffer.byteLength,
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(params.asVoice === undefined ? {} : { asVoice: params.asVoice }),
    release: async () => {
      context.written.delete(filePath);
      await rm(directory, { recursive: true, force: true });
    },
  };
  context.written.set(filePath, staged);
  return staged;
}

/** Bytes the model inlined: `buffer`, or a `data:` URL written into `media`. */
function inlineBytesOf(source: ChannelMediaSource): string | undefined {
  return (
    source.buffer ??
    (source.media !== undefined && DATA_URL.test(source.media) ? source.media : undefined)
  );
}

async function stageInline(
  context: StagerContext,
  source: ChannelMediaSource,
  inline: string,
): Promise<StagedChannelMedia> {
  const decoded = decodeInlineMedia(inline);
  const headerMime = source.mimeType ?? decoded.mimeType;
  return await stageBytes(context, {
    buffer: decoded.buffer,
    fileName: safeFileName(source.fileName ?? defaultInlineName(headerMime)),
    headerMime,
    asVoice: source.asVoice,
  });
}

async function stageRemote(
  context: StagerContext,
  source: ChannelMediaSource,
  url: string,
): Promise<StagedChannelMedia> {
  const remote = await fetchRemoteMedia({
    url,
    maxBytes: context.maxBytes,
    ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
    ...(context.lookupImpl === undefined ? {} : { lookupImpl: context.lookupImpl }),
  }).catch((error: unknown) => {
    throw error instanceof RemoteMediaRefusedError
      ? new ChannelMediaRefusedError(error.message)
      : error;
  });
  const headerMime = source.mimeType ?? remote.contentType;
  return await stageBytes(context, {
    buffer: remote.buffer,
    fileName: safeFileName(source.fileName ?? remote.fileName ?? defaultInlineName(headerMime)),
    headerMime,
    asVoice: source.asVoice,
  });
}

async function stageLocal(
  context: StagerContext,
  source: ChannelMediaSource,
  localPath: string,
): Promise<StagedChannelMedia> {
  const alreadyStaged = context.written.get(localPath);
  if (alreadyStaged !== undefined) {
    return {
      ...alreadyStaged,
      ...(source.fileName === undefined ? {} : { fileName: safeFileName(source.fileName) }),
      ...(source.mimeType === undefined ? {} : { mimeType: source.mimeType }),
      ...(source.asVoice === undefined ? {} : { asVoice: source.asVoice }),
    };
  }
  const resolved = resolveProjectFile(context.projectRoot, localPath);
  const fileName = source.fileName ?? mediaFileName(resolved.path);
  assertWithinChannelCap({
    channel: context.channel,
    sizeBytes: resolved.sizeBytes,
    fileName,
  });
  const mimeType =
    source.mimeType ??
    (await detectMime({
      buffer: await readSniffPrefix(resolved.path),
      filePath: resolved.path,
    }));
  // A Project file is uploaded where it lies: staging a copy would double the
  // bytes on disk and hand the vertical a path outside the authorized root.
  return {
    filePath: resolved.path,
    fileName,
    sizeBytes: resolved.sizeBytes,
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(source.asVoice === undefined ? {} : { asVoice: source.asVoice }),
  };
}

/** Builds the per-call stager. Every source it accepts ends as a local file. */
export function createChannelMediaStager(options: ChannelMediaStagerOptions): ChannelMediaStager {
  const context: StagerContext = {
    channel: options.channel,
    projectRoot: options.projectRoot,
    maxBytes: mediaMaxBytesForChannel(options.channel),
    stagingRoot: options.stagingRoot ?? path.join(tmpdir(), "paseo-hub-channel-outbound-media"),
    fetchImpl: options.fetchImpl,
    lookupImpl: options.lookupImpl,
    written: new Map(),
  };
  return async (source) => {
    const inline = inlineBytesOf(source);
    if (inline !== undefined) return await stageInline(context, source, inline);
    const media = source.media?.trim();
    if (!media) {
      throw new ChannelMediaRefusedError("media requires a path, a URL, or buffer bytes");
    }
    if (REMOTE_URL.test(media)) return await stageRemote(context, source, media);
    const localPath = media.startsWith("file://") ? media.slice("file://".length) : media;
    return await stageLocal(context, source, localPath);
  };
}

/** Strips any directory part a model may have put in a file name. */
function safeFileName(name: string): string {
  const base = path.basename(name.trim().replaceAll("\\", "/"));
  return base === "" || base === "." || base === ".." ? "attachment" : base;
}

const INLINE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "video/mp4": ".mp4",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
};

function defaultInlineName(mimeType: string | undefined): string {
  return `attachment${INLINE_EXTENSIONS[mimeType?.toLowerCase() ?? ""] ?? ".bin"}`;
}

/**
 * Runs `run` with `stager` installed behind core's media host adapters, so a
 * ported core path that stages bytes (upstream's gateway workspace media, the
 * TTS attachment writer) reaches the Hub's boundary instead of failing loudly.
 */
export function runWithChannelMediaStager<T>(stager: ChannelMediaStager, run: () => T): T {
  return runWithMediaBufferStager(
    async (buffer, contentType, _subdir, _maxBytes, originalFilename) =>
      await stager({
        buffer: buffer.toString("base64"),
        ...(contentType === undefined ? {} : { mimeType: contentType }),
        ...(originalFilename === undefined ? {} : { fileName: originalFilename }),
      }).then((staged) => ({
        path: staged.filePath,
        ...(staged.mimeType === undefined ? {} : { contentType: staged.mimeType }),
      })),
    run,
  );
}
