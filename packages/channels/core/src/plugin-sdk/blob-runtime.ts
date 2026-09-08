// upstream: src/plugin-sdk/blob-runtime.ts@5d8067a4483
export { canonicalizeBase64 } from "../media-core/base64.js";

/** Use immediately in a Blob constructor, which snapshots this exact byte range. */
export function bufferToBlobPart(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return buffer.buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : Uint8Array.from(buffer);
}
