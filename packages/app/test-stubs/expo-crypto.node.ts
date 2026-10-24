import { webcrypto } from "node:crypto";

// Expo 57's Crypto barrel also exports AES, whose module imports bare `expo` and
// initializes Metro's winter runtime. Node unit tests have no Metro runtime.
// Keep the primitives the app uses real; unsupported digests reject in WebCrypto.
// This adapter is scoped to the unit project, never the browser project or app.
export const CryptoDigestAlgorithm = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA384: "SHA-384",
  SHA512: "SHA-512",
  MD2: "MD2",
  MD4: "MD4",
  MD5: "MD5",
} as const;

export const getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
export const randomUUID = () => webcrypto.randomUUID();

export function getRandomBytes(byteCount: number): Uint8Array<ArrayBuffer> {
  const size = Math.floor(byteCount);
  if (typeof byteCount !== "number" || Number.isNaN(byteCount) || size < 0 || size > 1024) {
    throw new TypeError("expo-crypto: getRandomBytes expected a valid number from range 0...1024");
  }
  return getRandomValues(new Uint8Array(size));
}

export async function getRandomBytesAsync(byteCount: number): Promise<Uint8Array<ArrayBuffer>> {
  return getRandomBytes(byteCount);
}

export function digest(...args: Parameters<typeof webcrypto.subtle.digest>): Promise<ArrayBuffer> {
  return webcrypto.subtle.digest(...args);
}
