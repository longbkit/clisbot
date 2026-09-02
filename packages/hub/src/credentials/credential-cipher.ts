import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = 1;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DEFAULT_KEY_ID = "primary";

export interface CredentialEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  keyId: string;
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
}

export interface CredentialCipher {
  readonly keyId: string;
  encrypt(owner: string, value: unknown): CredentialEnvelope;
  decrypt(owner: string, envelope: unknown): unknown;
}

export class CredentialCipherError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialCipherError";
  }
}

export function createCredentialCipher(input: {
  keyId: string;
  masterKey: Uint8Array;
  random?: (size: number) => Uint8Array;
}): CredentialCipher {
  const keyId = requireKeyId(input.keyId);
  const key = Buffer.from(input.masterKey);
  if (key.byteLength !== KEY_BYTES) {
    throw new CredentialCipherError("credential master key must contain exactly 32 bytes");
  }
  const generateRandom = input.random ?? randomBytes;
  return {
    keyId,
    encrypt(owner, value) {
      const normalizedOwner = requireOwner(owner);
      const nonce = Buffer.from(generateRandom(NONCE_BYTES));
      if (nonce.byteLength !== NONCE_BYTES) {
        throw new CredentialCipherError("credential nonce source returned an invalid length");
      }
      const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(additionalAuthenticatedData(normalizedOwner));
      const plaintext = Buffer.from(JSON.stringify(value), "utf8");
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        version: ENVELOPE_VERSION,
        algorithm: ALGORITHM,
        keyId,
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        authenticationTag: cipher.getAuthTag().toString("base64url"),
      };
    },
    decrypt(owner: string, envelope: unknown): unknown {
      const normalizedOwner = requireOwner(owner);
      const parsed = parseCredentialEnvelope(envelope);
      if (!safeEqual(parsed.keyId, keyId)) {
        throw new CredentialCipherError("credential envelope key is unavailable");
      }
      try {
        const nonce = decodeBase64Url(parsed.nonce, NONCE_BYTES, "nonce");
        const tag = decodeBase64Url(parsed.authenticationTag, TAG_BYTES, "authentication tag");
        const ciphertext = decodeBase64Url(parsed.ciphertext, undefined, "ciphertext");
        const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
        decipher.setAAD(additionalAuthenticatedData(normalizedOwner));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(plaintext.toString("utf8")) as unknown;
      } catch (error) {
        if (error instanceof CredentialCipherError) throw error;
        throw new CredentialCipherError("credential envelope authentication failed", {
          cause: error,
        });
      }
    },
  };
}

export async function readCredentialCipherEnvironment(
  environment: Record<string, string | undefined>,
  options: { hubDataDirectory?: string } = {},
): Promise<CredentialCipher> {
  const encoded = nonEmpty(environment["PASEO_HUB_CREDENTIAL_MASTER_KEY"]);
  const file = nonEmpty(environment["PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE"]);
  if ((encoded === undefined) === (file === undefined)) {
    throw new CredentialCipherError(
      "set exactly one of PASEO_HUB_CREDENTIAL_MASTER_KEY or PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE",
    );
  }
  if (file !== undefined) {
    if (!isAbsolute(file)) {
      throw new CredentialCipherError("credential master key file path must be absolute");
    }
    if (
      options.hubDataDirectory !== undefined &&
      isWithin(resolve(options.hubDataDirectory), resolve(file))
    ) {
      throw new CredentialCipherError(
        "credential master key file must be outside the Hub data directory",
      );
    }
  }
  const material = encoded ?? (await readMasterKeyFile(file!));
  return createCredentialCipher({
    keyId: nonEmpty(environment["PASEO_HUB_CREDENTIAL_KEY_ID"]) ?? DEFAULT_KEY_ID,
    masterKey: decodeMasterKey(material),
  });
}

export function parseCredentialEnvelope(value: unknown): CredentialEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CredentialCipherError("stored credential envelope is malformed");
  }
  if (
    !("version" in value) ||
    value.version !== ENVELOPE_VERSION ||
    !("algorithm" in value) ||
    value.algorithm !== ALGORITHM ||
    !("keyId" in value) ||
    typeof value.keyId !== "string" ||
    !("nonce" in value) ||
    typeof value.nonce !== "string" ||
    !("ciphertext" in value) ||
    typeof value.ciphertext !== "string" ||
    !("authenticationTag" in value) ||
    typeof value.authenticationTag !== "string"
  ) {
    throw new CredentialCipherError("stored credential envelope is malformed");
  }
  return {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    keyId: requireKeyId(value.keyId),
    nonce: value.nonce,
    ciphertext: value.ciphertext,
    authenticationTag: value.authenticationTag,
  };
}

function additionalAuthenticatedData(owner: string): Buffer {
  return Buffer.from(`paseo-hub:credential:${ENVELOPE_VERSION}:${owner}`, "utf8");
}

function decodeMasterKey(value: string): Buffer {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(normalized)) {
    throw new CredentialCipherError("credential master key must be 32 bytes encoded as base64");
  }
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.byteLength !== KEY_BYTES || decoded.toString("base64") !== normalized) {
    throw new CredentialCipherError("credential master key must be 32 bytes encoded as base64");
  }
  return decoded;
}

async function readMasterKeyFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new CredentialCipherError("credential master key file could not be read", {
      cause: error,
    });
  }
}

function decodeBase64Url(value: string, expectedBytes: number | undefined, field: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new CredentialCipherError(`credential envelope ${field} is malformed`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    (expectedBytes !== undefined && decoded.byteLength !== expectedBytes) ||
    decoded.toString("base64url") !== value
  ) {
    throw new CredentialCipherError(`credential envelope ${field} is malformed`);
  }
  return decoded;
}

function requireOwner(value: string): string {
  if (value.length === 0) throw new CredentialCipherError("credential owner must not be empty");
  return value;
}

function requireKeyId(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(value)) {
    throw new CredentialCipherError("credential key ID is malformed");
  }
  return value;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function isWithin(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}
