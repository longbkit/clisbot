import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function syncDirectory(directory: string): Promise<void> {
  // Windows does not expose directory fsync through Node. File fsync remains mandatory.
  if (process.platform === "win32") return;
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Persist every newly created directory entry, including the session's ancestors. */
export async function createDurableDirectory(directory: string): Promise<void> {
  const created = await fs.mkdir(directory, { recursive: true });
  if (!created) return;
  let current = path.resolve(directory);
  const first = path.resolve(created);
  while (true) {
    await syncDirectory(current);
    if (current === first) break;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Created directory is outside its parent chain");
    current = parent;
  }
  await syncDirectory(path.dirname(first));
}

export async function writeDurableFile(filePath: string, data: string | Uint8Array): Promise<void> {
  const directory = path.dirname(filePath);
  await createDurableDirectory(directory);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, filePath);
    await syncDirectory(directory);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeDurableJson(filePath: string, value: unknown): Promise<void> {
  await writeDurableFile(filePath, JSON.stringify(value));
}
