import { getDesktopHost } from "@/desktop/host";
interface EncryptedSecret {
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("clisbot-device-credentials", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("secrets");
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => {
      database = undefined;
      reject(request.error);
    });
  });
  return database;
}

async function readEncrypted(key: string): Promise<EncryptedSecret | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("secrets", "readonly");
    const request = transaction.objectStore("secrets").get(key);
    transaction.addEventListener("complete", () =>
      resolve(request.result as EncryptedSecret | undefined),
    );
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

export async function readSecret(key: string): Promise<string | null> {
  const desktop = getDesktopHost();
  if (desktop) {
    if (!desktop.deviceSecrets)
      throw new Error("Update the desktop app to support secure device storage");
    return desktop.deviceSecrets.read(key);
  }
  const stored = await readEncrypted(key);
  if (!stored) return null;
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: stored.iv, additionalData: new TextEncoder().encode(key) },
    stored.key,
    stored.ciphertext,
  );
  return new TextDecoder().decode(clear);
}

export async function writeSecret(key: string, value: string): Promise<void> {
  const desktop = getDesktopHost();
  if (desktop) {
    if (!desktop.deviceSecrets)
      throw new Error("Update the desktop app to support secure device storage");
    return desktop.deviceSecrets.write(key, value);
  }
  const encryptionKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(key) },
    encryptionKey,
    new TextEncoder().encode(value),
  );
  await mutateSecret(key, { key: encryptionKey, iv, ciphertext });
}

export async function deleteSecret(key: string): Promise<void> {
  const desktop = getDesktopHost();
  if (desktop) {
    if (!desktop.deviceSecrets)
      throw new Error("Update the desktop app to support secure device storage");
    return desktop.deviceSecrets.delete(key);
  }
  await mutateSecret(key);
}

async function mutateSecret(key: string, value?: EncryptedSecret): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("secrets", "readwrite");
    const store = transaction.objectStore("secrets");
    if (value) store.put(value, key);
    else store.delete(key);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

export async function lockSecret<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks)
    throw new Error("Device pairing requires a secure browser with Web Locks support");
  return navigator.locks.request(`clisbot-device:${key}`, action);
}
