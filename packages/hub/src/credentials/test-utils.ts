import { createCipheriv, randomBytes } from "node:crypto";
import {
  createCredentialCipher,
  type CredentialCipher,
  type CredentialEnvelope,
  type CredentialEnvelopeVersion,
} from "./credential-cipher.js";

export const TEST_CREDENTIAL_KEY_ID = "test-key";
export const TEST_CREDENTIAL_MASTER_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, index) => index),
);

export function createTestCredentialCipher(): CredentialCipher {
  return createCredentialCipher({
    keyId: TEST_CREDENTIAL_KEY_ID,
    masterKey: TEST_CREDENTIAL_MASTER_KEY,
  });
}

/** An envelope as an older Hub build sealed it, under any AAD prefix and version. */
export function sealTestEnvelope(input: {
  prefix: string;
  version: CredentialEnvelopeVersion;
  owner: string;
  value: unknown;
  keyId?: string;
  masterKey?: Uint8Array;
}): CredentialEnvelope {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    input.masterKey ?? TEST_CREDENTIAL_MASTER_KEY,
    nonce,
    { authTagLength: 16 },
  );
  cipher.setAAD(Buffer.from(`${input.prefix}:credential:${input.version}:${input.owner}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(input.value), "utf8")),
    cipher.final(),
  ]);
  return {
    version: input.version,
    algorithm: "aes-256-gcm",
    keyId: input.keyId ?? TEST_CREDENTIAL_KEY_ID,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authenticationTag: cipher.getAuthTag().toString("base64url"),
  };
}
