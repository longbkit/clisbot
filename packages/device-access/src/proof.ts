import nacl from "tweetnacl";
import { fromByteArray, toByteArray } from "base64-js";

export interface DeviceKey {
  publicKey: string;
  privateKey: string;
}

export interface DeviceProof {
  backendId: string;
  credentialId: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

export interface ProofContext {
  purpose: "pair" | "hello" | "http";
  binding: string;
}

export function createDeviceKey(seed: Uint8Array): DeviceKey {
  const pair = nacl.sign.keyPair.fromSeed(seed);
  return { publicKey: fromByteArray(pair.publicKey), privateKey: fromByteArray(pair.secretKey) };
}

export function digest(value: string): string {
  return fromByteArray(nacl.hash(new TextEncoder().encode(value)));
}

function payload(proof: Omit<DeviceProof, "signature">, context: ProofContext): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      "clisbot-device-proof-v1",
      context.purpose,
      proof.backendId,
      proof.credentialId,
      proof.timestamp,
      proof.nonce,
      context.binding,
    ]),
  );
}

export function signDeviceProof(input: {
  key: DeviceKey;
  proof: Omit<DeviceProof, "signature">;
  context: ProofContext;
}): DeviceProof {
  return {
    ...input.proof,
    signature: fromByteArray(
      nacl.sign.detached(
        payload(input.proof, input.context),
        decode(input.key.privateKey, nacl.sign.secretKeyLength),
      ),
    ),
  };
}

export function verifyDeviceProof(input: {
  publicKey: string;
  proof: DeviceProof;
  context: ProofContext;
}): boolean {
  try {
    return nacl.sign.detached.verify(
      payload(input.proof, input.context),
      decode(input.proof.signature, nacl.sign.signatureLength),
      decode(input.publicKey, nacl.sign.publicKeyLength),
    );
  } catch {
    return false;
  }
}

export function isDevicePublicKey(publicKey: string): boolean {
  try {
    decode(publicKey, nacl.sign.publicKeyLength);
    return true;
  } catch {
    return false;
  }
}

function decode(value: string, length: number): Uint8Array {
  if (typeof value !== "string" || value.length > 128) throw new Error("Invalid key encoding");
  const bytes = toByteArray(value);
  if (bytes.length !== length || fromByteArray(bytes) !== value)
    throw new Error("Invalid key encoding");
  return bytes;
}

export function helloBinding(hello: {
  clientId: string;
  clientType: string;
  protocolVersion: number;
  accessTicket?: string;
}): string {
  return digest(
    JSON.stringify([
      hello.clientId,
      hello.clientType,
      hello.protocolVersion,
      hello.accessTicket ?? null,
    ]),
  );
}

export function httpBinding(input: { method: string; path: string; body: string }): string {
  return digest(JSON.stringify([input.method.toUpperCase(), input.path, digest(input.body)]));
}

/** Domain tag of the Google sign-in nonce. Changing the derivation means a new tag. */
export const GOOGLE_SIGN_IN_NONCE_BINDING = "clisbot-google-nonce-v2";

/**
 * The OIDC nonce of one Hub Google sign-in. It is derived, never handed out: the Hub that will
 * verify the ID token recomputes it from its own identity, and the app computes it from the
 * identity it pinned for the Hub it is actually logging into (the E2EE public key it authenticated
 * and the backend ID its device proofs are signed for). A Google token minted while the app was
 * connected to Hub X therefore carries X's binding and cannot be exchanged at another Hub T, even
 * when X relays T's transaction and client ID.
 *
 * base64url(SHA-512(JSON.stringify([tag, hubId, hubPublicKey, transactionId]))). The managed
 * sign-in page (app.clisbot.com/hub-google-auth.html) implements the same derivation with
 * WebCrypto; keep both in step.
 */
export function googleSignInNonce(input: {
  hubId: string;
  hubPublicKey: string;
  transactionId: string;
}): string {
  for (const value of [input.hubId, input.hubPublicKey, input.transactionId])
    if (typeof value !== "string" || value.length === 0 || value.length > 128)
      throw new Error("Invalid Google sign-in binding");
  return fromByteArray(
    nacl.hash(
      new TextEncoder().encode(
        JSON.stringify([
          GOOGLE_SIGN_IN_NONCE_BINDING,
          input.hubId,
          input.hubPublicKey,
          input.transactionId,
        ]),
      ),
    ),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
