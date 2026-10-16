import type { ReceiveCodec } from "@clisbot/relay/e2ee";

export interface NativeReceiveModule {
  openText(key: Uint8Array, frame: string): Promise<NativeOpenedFrame>;
  openBinary(key: Uint8Array, frame: Uint8Array): Promise<NativeOpenedFrame>;
}
interface NativeOpenedFrame {
  nonce: Uint8Array;
  plaintext: string | Uint8Array;
}
const CAPACITY_BYTES = 64 * 1024 * 1024;
const CAPACITY_FRAMES = 64;
// TweetNaCl secretbox: key 00..1f, nonce 20..37, BOM + "codec 😀\0".
const PROBE = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3UIDDaOUpj4jMXGjTtS4cox7i8sYiQz/1KcXK9oxI";
// The same authenticated vector as raw bytes also verifies Expo ByteArray results.
const BINARY_PROBE = new Uint8Array([
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55,
  80, 128, 195, 104, 229, 41, 143, 136, 204, 92, 104, 211, 181, 46, 28, 163, 30, 226, 242, 198, 34,
  67, 63, 245, 41, 197, 202, 246, 140, 72,
]);
const BINARY_PLAINTEXT = new Uint8Array([
  239, 187, 191, 99, 111, 100, 101, 99, 32, 240, 159, 152, 128, 0,
]);
const INPUT_ERRORS = new Set(["ERR_CODEC_MAC", "ERR_CODEC_PROTOCOL"]);

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** One process-owned serial native call, bounded before JNI copies are made. */
export function createReceiveCodecSelector(module: NativeReceiveModule | null) {
  let unavailable = module === null;
  let capability: Promise<ReceiveCodec | undefined> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let pendingBytes = 0;
  let pendingFrames = 0;

  const codec: ReceiveCodec = {
    open(key, frame, binary, signal) {
      const bytes = typeof frame === "string" ? frame.length * 2 : frame.byteLength;
      if (pendingBytes + bytes > CAPACITY_BYTES || pendingFrames >= CAPACITY_FRAMES) {
        return Promise.reject(new Error("Native receive capacity reached; reconnect"));
      }
      pendingBytes += bytes;
      pendingFrames++;
      const result = tail
        .then(async () => {
          if (signal?.aborted) throw new Error("Encrypted channel closed");
          if (unavailable || !module) throw new Error("Native receive codec unavailable");
          try {
            const opened =
              typeof frame === "string"
                ? await module.openText(key, frame)
                : await module.openBinary(key, new Uint8Array(frame));
            if (
              !(opened.nonce instanceof Uint8Array) ||
              opened.nonce.byteLength !== 24 ||
              (binary
                ? !(opened.plaintext instanceof Uint8Array)
                : typeof opened.plaintext !== "string")
            ) {
              throw new Error("Invalid native receive result");
            }
            return {
              nonce: bytesBuffer(opened.nonce),
              plaintext:
                typeof opened.plaintext === "string"
                  ? opened.plaintext
                  : bytesBuffer(opened.plaintext),
            };
          } catch (error) {
            const code =
              error && typeof error === "object" && "code" in error ? error.code : undefined;
            // Never retry this frame. Only a fresh channel may select the existing JS codec.
            // Untrusted MAC/protocol errors cannot disable native for other channels.
            if (typeof code !== "string" || !INPUT_ERRORS.has(code)) unavailable = true;
            throw error;
          }
        })
        .finally(() => {
          pendingBytes -= bytes;
          pendingFrames--;
        });
      // The serial tail must not retain the last (possibly large) plaintext result.
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  return async (): Promise<ReceiveCodec | undefined> => {
    if (unavailable) return undefined;
    capability ??= (async () => {
      try {
        const opened = await codec.open(
          Uint8Array.from({ length: 32 }, (_, i) => i),
          PROBE,
          false,
        );
        const nonce = new Uint8Array(opened.nonce);
        if (opened.plaintext !== "codec 😀\0" || !nonce.every((byte, i) => byte === i + 32)) {
          throw new Error("Native receive known-answer mismatch");
        }
        const binary = await codec.open(
          Uint8Array.from({ length: 32 }, (_, i) => i),
          BINARY_PROBE.buffer,
          true,
        );
        const bytes = new Uint8Array(binary.plaintext as ArrayBuffer);
        const binaryNonce = new Uint8Array(binary.nonce);
        if (
          bytes.length !== BINARY_PLAINTEXT.length ||
          !bytes.every((byte, i) => byte === BINARY_PLAINTEXT[i]) ||
          !binaryNonce.every((byte, i) => byte === i + 32)
        ) {
          throw new Error("Native binary receive known-answer mismatch");
        }
        return codec;
      } catch {
        unavailable = true;
        return undefined;
      }
    })();
    const selected = await capability;
    return unavailable ? undefined : selected;
  };
}
