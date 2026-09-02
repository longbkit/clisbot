import { createCredentialCipher, type CredentialCipher } from "./credential-cipher.js";

export function createTestCredentialCipher(): CredentialCipher {
  return createCredentialCipher({
    keyId: "test-key",
    masterKey: Buffer.from(Array.from({ length: 32 }, (_, index) => index)),
  });
}
