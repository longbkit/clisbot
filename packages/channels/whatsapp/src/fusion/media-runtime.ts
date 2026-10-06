// Fusion-owned additions to `plugin-sdk/media-runtime` for the WhatsApp
// vertical (D-WA-015). Everything else comes from core's carried barrel.
//
// - `resizeToJpeg`: upstream's image ops run on OpenClaw's own raster pipeline.
//   The ported image preview needs one 32px JPEG thumbnail; `sharp` (the image
//   library Baileys itself uses for thumbnails) makes it.
// - Voice notes: upstream transcodes outbound audio to Ogg/Opus with ffmpeg
//   (`src/media/audio-transcode.ts`). Core carries no ffmpeg executor
//   (D-CORE-225), so this runs upstream's same ffmpeg arguments directly against
//   the `ffmpeg` on the Hub host (`FFMPEG_PATH` overrides it). With no ffmpeg the
//   send fails with a message saying so, instead of posting a voice note
//   WhatsApp cannot play; Ogg/Opus audio never needs it.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export * from "@clisbot/channels-core/plugin-sdk/media-runtime";

/** Upstream's cap on a transcoded voice note, kept for the ported caller. */
export const MEDIA_FFMPEG_MAX_AUDIO_DURATION_SECS = 20 * 60;

export async function resizeToJpeg(params: {
  buffer: Buffer;
  maxSide: number;
  quality?: number;
  withoutEnlargement?: boolean;
}): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return await sharp(params.buffer)
    .rotate()
    .resize(params.maxSide, params.maxSide, {
      fit: "inside",
      withoutEnlargement: params.withoutEnlargement ?? true,
    })
    .jpeg({ quality: params.quality ?? 80 })
    .toBuffer();
}

/** Upstream's ffmpeg time limit for one media job. */
const FFMPEG_TIMEOUT_MS = 45_000;

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  const bin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (!error) return resolve();
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reject(
          new Error(
            "WhatsApp voice notes need Ogg/Opus audio, and this Hub has no ffmpeg to convert it. Install ffmpeg on the Hub host (or set FFMPEG_PATH), or send an .ogg/.opus file.",
          ),
        );
      }
      reject(new Error(`ffmpeg failed to convert the audio to Opus: ${String(stderr).trim() || error.message}`));
    });
  });
}

/** Upstream `transcodeAudioBufferToOpus`: arbitrary audio → mono Ogg/Opus. */
export async function transcodeAudioBufferToOpus(params: {
  audioBuffer: Buffer;
  inputFileName?: string;
  timeoutMs?: number;
  sampleRateHz?: number;
  bitrate?: string;
  channels?: number;
  maxDurationSeconds?: number;
  [option: string]: unknown;
}): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "clisbot-whatsapp-voice-"));
  try {
    const ext = path.extname(params.inputFileName ?? "").toLowerCase();
    const inputPath = path.join(dir, `input${/^\.[a-z0-9]{1,12}$/.test(ext) ? ext : ".audio"}`);
    const outputPath = path.join(dir, "voice.opus");
    await writeFile(inputPath, params.audioBuffer);
    await runFfmpeg(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-sn",
        "-dn",
        ...(params.maxDurationSeconds === undefined ? [] : ["-t", String(params.maxDurationSeconds)]),
        "-c:a",
        "libopus",
        "-b:a",
        params.bitrate ?? "64k",
        "-ar",
        String(params.sampleRateHz ?? 48_000),
        "-ac",
        String(params.channels ?? 1),
        "-f",
        "opus",
        outputPath,
      ],
      params.timeoutMs ?? FFMPEG_TIMEOUT_MS,
    );
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
