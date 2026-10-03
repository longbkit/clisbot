import { generateNonce } from "./crypto.js";
import { arrayBufferToBase64 } from "./base64.js";

const MAX_PEER_PREFIXES = 4096;

/** Nonces retain the existing NaCl bundle format; no plaintext negotiation can disable replay checks. */
export class ChannelNonces {
  private readonly prefix = generateNonce().slice(0, 16);
  private counter = 0;
  private readonly received = new Map<string, Uint8Array>();

  next(): Uint8Array {
    if (this.counter >= Number.MAX_SAFE_INTEGER) throw new Error("Channel nonce exhausted");
    const nonce = new Uint8Array(24);
    nonce.set(this.prefix);
    const counter = ++this.counter;
    const view = new DataView(nonce.buffer);
    view.setUint32(16, Math.floor(counter / 0x100000000));
    view.setUint32(20, counter % 0x100000000);
    return nonce;
  }

  /** Called only after successful MAC verification, before dispatching plaintext. */
  acceptAuthenticated(bundle: ArrayBuffer): void {
    const nonce = new Uint8Array(bundle, 0, 24);
    if (this.prefix.every((byte, index) => byte === nonce[index]))
      throw new Error("Reflected encrypted frame");
    const prefix = arrayBufferToBase64(bundle.slice(0, 16));
    const counter = nonce.slice(16);
    const previous = this.received.get(prefix);
    if (previous && !greaterThan(counter, previous)) throw new Error("Replayed encrypted frame");
    // COMPAT(randomChannelNonces): added in v0.10.2, remove after 2027-04-03 once
    // supported peers use one prefix per channel. Legacy random nonces each consume
    // an entry; close at capacity instead of evicting a nonce and admitting its replay.
    if (!previous && this.received.size >= MAX_PEER_PREFIXES)
      throw new Error("Legacy channel nonce capacity reached; reconnect or update peer");
    this.received.set(prefix, counter);
  }
}

function greaterThan(value: Uint8Array, previous: Uint8Array): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== previous[index]) return value[index] > previous[index];
  }
  return false;
}
