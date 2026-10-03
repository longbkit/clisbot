import { app, ipcMain, safeStorage } from "electron";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireTrustedRenderer } from "./hub-client.js";

export function registerDeviceCredentialHandlers(): void {
  ipcMain.handle("clisbot:device-secret:read", async (event, key: unknown) => {
    requireTrustedRenderer(event);
    const file = secretPath(key);
    requireEncryption();
    try {
      return safeStorage.decryptString(await readFile(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  });
  ipcMain.handle("clisbot:device-secret:write", async (event, key: unknown, value: unknown) => {
    requireTrustedRenderer(event);
    const file = secretPath(key);
    requireEncryption();
    if (typeof value !== "string" || value.length > 64 * 1024)
      throw new Error("Invalid device secret");
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}`;
    try {
      await writeFile(temporary, safeStorage.encryptString(value), { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  });
  ipcMain.handle("clisbot:device-secret:delete", async (event, key: unknown) => {
    requireTrustedRenderer(event);
    await unlink(secretPath(key)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  });
}

function secretPath(key: unknown): string {
  if (
    typeof key !== "string" ||
    !/^clisbot_(?:device|hub_session)\.[a-zA-Z0-9_-]{1,120}$/.test(key)
  )
    throw new Error("Invalid device storage key");
  return path.join(app.getPath("userData"), "device-credentials", key);
}

function requireEncryption(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
  )
    throw new Error("Enable the operating system keychain before pairing this desktop app");
}
