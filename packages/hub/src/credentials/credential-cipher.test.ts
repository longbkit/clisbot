import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  CredentialCipherError,
  createCredentialCipher,
  readCredentialCipherEnvironment,
} from "./credential-cipher.js";

const roots: string[] = [];
const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("credential cipher", () => {
  it("round-trips JSON without exposing plaintext and uses a fresh nonce", () => {
    let nonce = 0;
    const cipher = createCredentialCipher({
      keyId: "test-v1",
      masterKey: key,
      random: (size) => Buffer.alloc(size, nonce++),
    });
    const first = cipher.encrypt("provider-application:slack:A1", { token: "xapp-secret" });
    const second = cipher.encrypt("provider-application:slack:A1", { token: "xapp-secret" });

    assert.notEqual(first.nonce, second.nonce);
    assert.equal(JSON.stringify(first).includes("xapp-secret"), false);
    assert.deepEqual(cipher.decrypt("provider-application:slack:A1", first), {
      token: "xapp-secret",
    });
  });

  it("binds ciphertext to its owner and rejects tampering or the wrong key", () => {
    const cipher = createCredentialCipher({ keyId: "test-v1", masterKey: key });
    const envelope = cipher.encrypt("slack-connection:connection-1", { token: "xoxb-secret" });

    assert.throws(
      () => cipher.decrypt("slack-connection:connection-2", envelope),
      CredentialCipherError,
    );
    assert.throws(
      () => cipher.decrypt("slack-connection:connection-1", { ...envelope, ciphertext: "AA" }),
      CredentialCipherError,
    );
    assert.throws(
      () =>
        createCredentialCipher({ keyId: "test-v1", masterKey: Buffer.alloc(32, 7) }).decrypt(
          "slack-connection:connection-1",
          envelope,
        ),
      CredentialCipherError,
    );
  });

  it("loads one external base64 key from environment", async () => {
    const cipher = await readCredentialCipherEnvironment({
      PASEO_HUB_CREDENTIAL_MASTER_KEY: key.toString("base64"),
      PASEO_HUB_CREDENTIAL_KEY_ID: "deployment-v3",
    });

    assert.equal(cipher.keyId, "deployment-v3");
    assert.equal(cipher.decrypt("owner", cipher.encrypt("owner", "secret")), "secret");
  });

  it("loads an absolute mounted key file outside the Hub data directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "hub-credential-key-"));
    roots.push(root);
    const dataDirectory = join(root, "data");
    const keyFile = join(root, "mounted-key");
    await writeFile(keyFile, `${key.toString("base64")}\n`, { mode: 0o400 });

    const cipher = await readCredentialCipherEnvironment(
      { PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE: keyFile },
      { hubDataDirectory: dataDirectory },
    );

    assert.equal(cipher.decrypt("owner", cipher.encrypt("owner", 42)), 42);
  });

  it("reads with the previous key while writing with the current one", async () => {
    const root = await mkdtemp(join(tmpdir(), "hub-credential-rotate-"));
    roots.push(root);
    const retired = Buffer.alloc(32, 9);
    const currentFile = join(root, "current-key");
    const previousFile = join(root, "previous-key");
    await writeFile(currentFile, `${key.toString("base64")}\n`);
    await writeFile(previousFile, `${retired.toString("base64")}\n`);

    const before = createCredentialCipher({ keyId: "primary", masterKey: retired });
    const sealed = before.encrypt("owner", { token: "canary" });

    const rotated = await readCredentialCipherEnvironment({
      PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE: currentFile,
      PASEO_HUB_CREDENTIAL_MASTER_KEY_PREVIOUS_FILE: previousFile,
    });
    assert.deepEqual(rotated.decrypt("owner", sealed), { token: "canary" });
    // The re-seal is a plain write, and it lands under the current key alone.
    const resealed = rotated.encrypt("owner", { token: "canary" });
    const currentOnly = createCredentialCipher({ keyId: "primary", masterKey: key });
    assert.deepEqual(currentOnly.decrypt("owner", resealed), { token: "canary" });
    assert.throws(() => currentOnly.decrypt("owner", sealed), CredentialCipherError);
    // Retiring the previous key retires the rows nobody rewrote.
    const currentAlone = await readCredentialCipherEnvironment({
      PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE: currentFile,
    });
    assert.throws(() => currentAlone.decrypt("owner", sealed), CredentialCipherError);
  });

  // A read only tries keys whose id matches the envelope's, so the retired key's
  // id has to be the id the OLD rows carry. Defaulting it to the current key's
  // id meant a rotation that renamed the key never tried the retired material —
  // silently, at read time, one row at a time.
  it("keeps a named rotation readable and refuses one that cannot be", async () => {
    const root = await mkdtemp(join(tmpdir(), "hub-credential-named-"));
    roots.push(root);
    const retired = Buffer.alloc(32, 7);
    const currentFile = join(root, "current-key");
    const previousFile = join(root, "previous-key");
    await writeFile(currentFile, key.toString("base64"));
    await writeFile(previousFile, retired.toString("base64"));
    const sealed = createCredentialCipher({ keyId: "2026-08", masterKey: retired }).encrypt(
      "owner",
      { token: "canary" },
    );

    await assert.rejects(
      readCredentialCipherEnvironment({
        PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE: currentFile,
        PASEO_HUB_CREDENTIAL_MASTER_KEY_PREVIOUS_FILE: previousFile,
        PASEO_HUB_CREDENTIAL_KEY_ID: "2026-09",
      }),
      CredentialCipherError,
      "a named current key with no named retired key is a boot failure, not a read failure",
    );

    const named = await readCredentialCipherEnvironment({
      PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE: currentFile,
      PASEO_HUB_CREDENTIAL_MASTER_KEY_PREVIOUS_FILE: previousFile,
      PASEO_HUB_CREDENTIAL_KEY_ID: "2026-09",
      PASEO_HUB_CREDENTIAL_KEY_ID_PREVIOUS: "2026-08",
    });
    assert.deepEqual(named.decrypt("owner", sealed), { token: "canary" });
    assert.equal(named.keyId, "2026-09");
  });

  it("fails closed for missing, ambiguous, malformed, or data-directory key material", async () => {
    const root = await mkdtemp(join(tmpdir(), "hub-credential-key-"));
    roots.push(root);
    const keyFile = join(root, "key");
    await writeFile(keyFile, key.toString("base64"));

    await assert.rejects(readCredentialCipherEnvironment({}), CredentialCipherError);
    await assert.rejects(
      readCredentialCipherEnvironment({
        PASEO_HUB_CREDENTIAL_MASTER_KEY: key.toString("base64"),
        PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE: keyFile,
      }),
      CredentialCipherError,
    );
    await assert.rejects(
      readCredentialCipherEnvironment({ PASEO_HUB_CREDENTIAL_MASTER_KEY: "not-base64" }),
      CredentialCipherError,
    );
    await assert.rejects(
      readCredentialCipherEnvironment(
        { PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE: keyFile },
        { hubDataDirectory: root },
      ),
      CredentialCipherError,
    );
  });
});
