import type { SharedKey } from "./crypto.js";

/** Optional authenticated opener for negotiated frames. No protocol/key/nonce ownership. */
export interface ReceiveCodec {
  open(
    key: SharedKey,
    frame: string | ArrayBuffer,
    isBinary: boolean,
    signal?: AbortSignal,
  ): Promise<{ nonce: ArrayBuffer; plaintext: string | ArrayBuffer }>;
}

// checkout-git.ts budgets supported encrypted diff frames against 32 MiB.
// Keep one maximum frame admissible; pending strings are charged at UTF-16 size.
// This is a disconnect safety net, not transport flow control. No frames are dropped.
export const RECEIVE_FRAME_BYTES = 32 * 1024 * 1024;
export const RECEIVE_QUEUE_BYTES = 2 * RECEIVE_FRAME_BYTES;
export const RECEIVE_QUEUE_FRAMES = 64;
