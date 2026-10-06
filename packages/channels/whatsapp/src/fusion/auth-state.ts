// Fusion-owned `useMultiFileAuthState` (D-WA-010).
//
// Baileys' own helper writes one JSON file per key with `fs/promises` into a
// real folder. This is the same function — the same file names
// (`fixFileName`), the same `BufferJSON` encoding, the same `initAuthCreds`
// default and the same `app-state-sync-key` revival — over the encrypted
// virtual auth directory (`fusion/auth-fs.ts`). Baileys serializes file access
// with a per-path mutex because its reads and writes are separate syscalls; the
// in-memory map here is read and written synchronously, so it needs none.
import path from "node:path";
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "baileys";
import { ensureDir, readFile, rm, writeFile } from "./auth-fs.js";

const fixFileName = (file: string) => file.replace(/\//g, "__").replace(/:/g, "-");

export async function useMultiFileAuthState(
  folder: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  await ensureDir(folder);
  const filePath = (file: string) => path.join(folder, fixFileName(file));
  const writeData = (data: unknown, file: string) =>
    writeFile(filePath(file), JSON.stringify(data, BufferJSON.replacer));
  const readData = async (file: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(filePath(file)), BufferJSON.reviver) as unknown;
    } catch {
      return null;
    }
  };
  const removeData = (file: string) => rm(filePath(file));

  const creds = ((await readData("creds.json")) as AuthenticationCreds | null) ?? initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
              }
              data[id] = value as SignalDataTypeMap[T];
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            const entries = data[category as keyof SignalDataTypeMap] ?? {};
            for (const id in entries) {
              const value = entries[id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
  };
}
