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
