import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const ALGORITHM = "aes-256-gcm";
/**
 * Envelope versions. The number is part of the AAD, so it also names which
 * owner string the writer bound: v1 owners are the historical ones, v2 owners
 * additionally bind the organization (`db/pg.ts` `channelCredentialOwner`).
 * Reads accept both and writes mint `CURRENT_ENVELOPE_VERSION`, so a v1 row is
 * re-sealed the next time its credential is written — no migration.
 */
export const CREDENTIAL_ENVELOPE_VERSIONS = [1, 2] as const;
const CURRENT_ENVELOPE_VERSION = 2;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DEFAULT_KEY_ID = "primary";

export type CredentialEnvelopeVersion = (typeof CREDENTIAL_ENVELOPE_VERSIONS)[number];

export interface CredentialEnvelope {
  version: CredentialEnvelopeVersion;
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

/** The version a stored envelope was sealed with, so a caller that changed its
 * owner string between versions can rebuild the one this row was sealed under. */
export function credentialEnvelopeVersion(value: unknown): CredentialEnvelopeVersion {
  return parseCredentialEnvelope(value).version;
}

export class CredentialCipherError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialCipherError";
  }
}

/** One master key the Hub can read with. Writes always use the first. */
interface CredentialKey {
  keyId: string;
  key: Buffer;
}

export function createCredentialCipher(input: {
  keyId: string;
  masterKey: Uint8Array;
  /**
   * Retired keys, newest first. Reads fall back to them when the current key
   * cannot open a row; writes never use them. This is what makes rotation
   * possible without an offline re-encrypt pass: run with both keys until every
   * row has been written once, then drop the previous one.
   */
  previousKeys?: readonly { keyId: string; masterKey: Uint8Array }[];
  random?: (size: number) => Uint8Array;
}): CredentialCipher {
  const current = toCredentialKey(input.keyId, input.masterKey);
  const keys = [
    current,
    ...(input.previousKeys ?? []).map((k) => toCredentialKey(k.keyId, k.masterKey)),
  ];
  const generateRandom = input.random ?? randomBytes;
  return {
    keyId: current.keyId,
    encrypt(owner, value) {
      const nonce = Buffer.from(generateRandom(NONCE_BYTES));
      if (nonce.byteLength !== NONCE_BYTES) {
        throw new CredentialCipherError("credential nonce source returned an invalid length");
      }
      return seal(current, requireOwner(owner), nonce, value);
    },
    decrypt(owner: string, envelope: unknown): unknown {
      const normalizedOwner = requireOwner(owner);
      const parsed = parseCredentialEnvelope(envelope);
      const candidates = keys.filter((candidate) => safeEqual(candidate.keyId, parsed.keyId));
      if (candidates.length === 0) {
        throw new CredentialCipherError("credential envelope key is unavailable");
      }
      let failure: unknown;
      for (const candidate of candidates) {
        try {
          return open(candidate, normalizedOwner, parsed);
        } catch (error) {
          failure = error;
        }
      }
      throw new CredentialCipherError("credential envelope authentication failed", {
        cause: failure,
      });
    },
  };
}

function toCredentialKey(keyId: string, masterKey: Uint8Array): CredentialKey {
  const key = Buffer.from(masterKey);
  if (key.byteLength !== KEY_BYTES) {
    throw new CredentialCipherError("credential master key must contain exactly 32 bytes");
  }
  return { keyId: requireKeyId(keyId), key };
}

function seal(
  { keyId, key }: CredentialKey,
  owner: string,
  nonce: Buffer,
  value: unknown,
): CredentialEnvelope {
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalAuthenticatedData(owner, CURRENT_ENVELOPE_VERSION));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: CURRENT_ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    keyId,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authenticationTag: cipher.getAuthTag().toString("base64url"),
  };
}

function open({ key }: CredentialKey, owner: string, parsed: CredentialEnvelope): unknown {
  const nonce = decodeBase64Url(parsed.nonce, NONCE_BYTES, "nonce");
  const tag = decodeBase64Url(parsed.authenticationTag, TAG_BYTES, "authentication tag");
  const ciphertext = decodeBase64Url(parsed.ciphertext, undefined, "ciphertext");
  const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(additionalAuthenticatedData(owner, parsed.version));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as unknown;
}

/**
 * The cipher this process runs with. `..._MASTER_KEY_FILE` is preferred over
 * `..._MASTER_KEY`: a path is not visible in `/proc/<pid>/environ` or in a
 * process listing the way the key material itself is.
 *
 * `..._MASTER_KEY_PREVIOUS_FILE` is the rotation seam. Point it at the retired
 * key, name that key in `..._KEY_ID_PREVIOUS`, and every read falls back to it
 * while writes seal with the new one; the procedure is in
 * docs/channels-operations.md.
 */
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
  const previousFile = nonEmpty(environment["PASEO_HUB_CREDENTIAL_MASTER_KEY_PREVIOUS_FILE"]);
  for (const path of [file, previousFile]) {
    if (path !== undefined) requireExternalKeyFile(path, options.hubDataDirectory);
  }
  const material = encoded ?? (await readMasterKeyFile(file!));
  const keyId = nonEmpty(environment["PASEO_HUB_CREDENTIAL_KEY_ID"]) ?? DEFAULT_KEY_ID;
  // A read tries only the keys whose id matches the envelope's, so the retired
  // key's id has to be the id the OLD rows carry. Unnamed keys all carry the
  // default, which is the documented rotation (both keys tried in order); a
  // named current key says nothing about what the old rows were sealed under,
  // and defaulting to it meant the retired material was never tried at all —
  // every pre-rotation row answered "credential envelope key is unavailable" at
  // read time instead of failing here, at boot, with the fix in the message.
  const previousKeyId =
    nonEmpty(environment["PASEO_HUB_CREDENTIAL_KEY_ID_PREVIOUS"]) ??
    (keyId === DEFAULT_KEY_ID ? DEFAULT_KEY_ID : undefined);
  if (previousFile !== undefined && previousKeyId === undefined) {
    throw new CredentialCipherError(
      "set PASEO_HUB_CREDENTIAL_KEY_ID_PREVIOUS to the id the retired key sealed with when PASEO_HUB_CREDENTIAL_KEY_ID names the current one",
    );
  }
  return createCredentialCipher({
    keyId,
    masterKey: decodeMasterKey(material),
    ...(previousFile === undefined || previousKeyId === undefined
      ? {}
      : {
          previousKeys: [
            {
              keyId: previousKeyId,
              masterKey: decodeMasterKey(await readMasterKeyFile(previousFile)),
            },
          ],
        }),
  });
}

/** A key file must be absolute and must not sit inside the Hub data directory:
 * a backup of the database would otherwise carry the key that opens it. */
function requireExternalKeyFile(path: string, hubDataDirectory: string | undefined): void {
  if (!isAbsolute(path)) {
    throw new CredentialCipherError("credential master key file path must be absolute");
  }
  if (hubDataDirectory !== undefined && isWithin(resolve(hubDataDirectory), resolve(path))) {
    throw new CredentialCipherError(
      "credential master key file must be outside the Hub data directory",
    );
  }
}

export function parseCredentialEnvelope(value: unknown): CredentialEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CredentialCipherError("stored credential envelope is malformed");
  }
  if (
    !("version" in value) ||
    !isEnvelopeVersion(value.version) ||
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
    version: value.version,
    algorithm: ALGORITHM,
    keyId: requireKeyId(value.keyId),
    nonce: value.nonce,
    ciphertext: value.ciphertext,
    authenticationTag: value.authenticationTag,
  };
}

function isEnvelopeVersion(value: unknown): value is CredentialEnvelopeVersion {
  return CREDENTIAL_ENVELOPE_VERSIONS.some((version) => version === value);
}

function additionalAuthenticatedData(owner: string, version: CredentialEnvelopeVersion): Buffer {
  return Buffer.from(`paseo-hub:credential:${version}:${owner}`, "utf8");
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
