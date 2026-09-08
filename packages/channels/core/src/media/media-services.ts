// upstream: src/media/media-services.ts@5d8067a4483
// D-CORE-225: upstream's media service barrel re-exports the ffmpeg executor,
// the rastermill image processor and the media prober — native toolchain
// dependencies Fusion does not carry into a channel vertical. The two probes the
// ported Telegram send path calls keep upstream's signatures.
//
// `getImageMetadata` matters for behavior, not diagnostics: upstream sends an
// image as a *document* whenever dimensions are unavailable, so a stub that
// always answers "unknown" would silently stop every photo from posting as a
// photo. The common outbound formats are parsed from their headers here; an
// unrecognized container still answers "unknown" and takes upstream's document
// fallback. Video probing has no header-only equivalent and stays unknown.
export type ImageMetadata = { width: number; height: number; format?: string };
export type VideoDimensions = { width: number; height: number };

function readPngSize(buffer: Buffer): ImageMetadata | null {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: "png" };
}

function readGifSize(buffer: Buffer): ImageMetadata | null {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") {
    return null;
  }
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), format: "gif" };
}

function readJpegSize(buffer: Buffer): ImageMetadata | null {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1] ?? 0;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    // SOFn frame headers carry the dimensions; DHT/DAC/RSTn/SOS do not.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        format: "jpeg",
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpSize(buffer: Buffer): ImageMetadata | null {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    return null;
  }
  if (buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
      format: "webp",
    };
  }
  if (chunk === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      format: "webp",
    };
  }
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
  }
  return null;
}

/** Image dimensions for outbound photo sends; null when the container is unrecognized. */
export async function getImageMetadata(buffer: Buffer): Promise<ImageMetadata | null> {
  return (
    readPngSize(buffer) ?? readJpegSize(buffer) ?? readGifSize(buffer) ?? readWebpSize(buffer)
  );
}

/** Video dimensions for outbound video sends. Unknown without ffprobe. */
export async function probeVideoDimensions(buffer: Buffer): Promise<VideoDimensions | undefined> {
  void buffer;
  return undefined;
}
