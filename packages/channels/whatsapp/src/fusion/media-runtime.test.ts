import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resizeToJpeg, transcodeAudioBufferToOpus } from "./media-runtime.js";

function hasFfmpeg(): boolean {
  try {
    execFileSync(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** A 0.2 s 440 Hz mono 16-bit PCM WAV. */
function sineWav(): Buffer {
  const rate = 8000;
  const samples = rate / 5;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe("fusion media runtime", () => {
  it.skipIf(!hasFfmpeg())("converts other audio to an Ogg/Opus voice note with upstream's arguments", async () => {
    const opus = await transcodeAudioBufferToOpus({ audioBuffer: sineWav(), inputFileName: "note.wav", maxDurationSeconds: 60 });
    expect(opus.subarray(0, 4).toString("latin1")).toBe("OggS");
  });

  it("says what is missing when the Hub host has no ffmpeg", async () => {
    const previous = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = "/nonexistent/ffmpeg";
    try {
      await expect(transcodeAudioBufferToOpus({ audioBuffer: sineWav(), inputFileName: "note.mp3" })).rejects.toThrow(/no ffmpeg/);
    } finally {
      if (previous === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = previous;
    }
  });

  it("makes a JPEG preview no larger than the requested side", async () => {
    const { default: sharp } = await import("sharp");
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#3366cc" } }).png().toBuffer();
    const jpeg = await resizeToJpeg({ buffer: png, maxSide: 32, quality: 50 });
    const meta = await sharp(jpeg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 32, 24]);
  });
});
