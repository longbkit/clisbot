import { expect, test } from "vitest";
import { deleteSecret, lockSecret, readSecret, writeSecret } from "./secret-storage.web";

test("browser credentials persist with a non-extractable key and bound ciphertext", async () => {
  const id = `browser-device-${crypto.randomUUID()}`;
  try {
    await lockSecret(id, () => writeSecret(id, "private-device-key"));
    expect(await readSecret(id)).toBe("private-device-key");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("clisbot-device-credentials", 1);
      open.addEventListener("success", () => resolve(open.result));
      open.addEventListener("error", () => reject(open.error));
    });
    const value = await new Promise<{ key: CryptoKey; ciphertext: ArrayBuffer }>(
      (resolve, reject) => {
        const transaction = db.transaction("secrets", "readonly");
        const request = transaction.objectStore("secrets").get(id);
        transaction.addEventListener("complete", () => resolve(request.result));
        transaction.addEventListener("abort", () => reject(transaction.error));
      },
    );
    expect(value.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", value.key)).rejects.toThrow();
    expect(new TextDecoder().decode(value.ciphertext)).not.toContain("private-device-key");
    db.close();
    await deleteSecret(id);
    expect(await readSecret(id)).toBeNull();
  } finally {
    await deleteSecret(id);
  }
});

test("browser credential mutations serialize across Web Locks", async () => {
  const key = `device-lock-${crypto.randomUUID()}`;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: string[] = [];
  const first = lockSecret(key, async () => {
    events.push("first");
    await held;
    events.push("released");
  });
  const second = lockSecret(key, async () => {
    events.push("second");
  });
  await expect.poll(() => events).toEqual(["first"]);
  release();
  await Promise.all([first, second]);
  expect(events).toEqual(["first", "released", "second"]);
});
