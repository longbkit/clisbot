import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import nacl from "tweetnacl";
import {
  generateKeyPair,
  exportPublicKey,
  exportSecretKey,
  importSecretKey,
  type KeyPair,
} from "@clisbot/relay/e2ee";

/** Corruption fails closed: an identity must never silently replace its pinned key. */
export async function loadServiceKey(path: string): Promise<{ key: KeyPair; publicKey: string }> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 15_000,
    update: 5_000,
    retries: { retries: 40, minTimeout: 25, maxTimeout: 25 },
  });
  try {
    let value: { publicKey: string; secretKey: string };
    try {
      value = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const pair = generateKeyPair();
      value = {
        publicKey: exportPublicKey(pair.publicKey),
        secretKey: exportSecretKey(pair.secretKey),
      };
      await writeFile(path, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    }
    await chmod(path, 0o600);
    const secretKey = importSecretKey(value.secretKey);
    const key = nacl.box.keyPair.fromSecretKey(secretKey);
    if (exportPublicKey(key.publicKey) !== value.publicKey) throw new Error("Service key mismatch");
    return { key, publicKey: value.publicKey };
  } finally {
    await release();
  }
}
