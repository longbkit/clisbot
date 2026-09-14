import { promises as fs } from "node:fs";
import path from "node:path";
import { createDurableDirectory, syncDirectory } from "./durable-file.js";

export function assertSessionId(id: string): void {
  if (!id || id === "." || id === ".." || /[\\/]/.test(id) || id.includes("\0")) {
    throw new Error(`Invalid session id: ${JSON.stringify(id)}`);
  }
}

/** Exact depth: root legacy, cwd legacy, cwd/agent/session.json. Never descend into subagents. */
export async function listSessionRecordPaths(
  baseDir: string,
  onSessionDirectory?: (directory: string) => void,
): Promise<string[]> {
  const paths: string[] = [];
  let roots;
  try {
    roots = await fs.readdir(baseDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  for (const root of roots.sort((a, b) => a.name.localeCompare(b.name))) {
    if (root.name.startsWith(".")) continue;
    const rootPath = path.join(baseDir, root.name);
    if (root.isFile() && root.name.endsWith(".json")) paths.push(rootPath);
    if (!root.isDirectory()) continue;
    for (const entry of await fs.readdir(rootPath, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isFile() && entry.name.endsWith(".json"))
        paths.push(path.join(rootPath, entry.name));
      if (!entry.isDirectory()) continue;
      onSessionDirectory?.(path.join(rootPath, entry.name));
      const recordPath = path.join(rootPath, entry.name, "session.json");
      try {
        if ((await fs.lstat(recordPath)).isFile()) paths.push(recordPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return paths.sort();
}

/** A hard link claims the destination without overwriting. Crash leaves identical bytes or one record. */
export async function moveSessionRecord(source: string, destination: string): Promise<void> {
  if (source === destination) return;
  await createDurableDirectory(path.dirname(destination));
  try {
    await fs.link(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const [left, right] = await Promise.all([fs.readFile(source), fs.readFile(destination)]);
    if (!left.equals(right))
      throw new Error(`Conflicting session records: ${source} and ${destination}`, {
        cause: error,
      });
  }
  const handle = await fs.open(destination, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(destination));
  await fs.unlink(source);
  await syncDirectory(path.dirname(source));
}

/** Offline only. Preserve journals/uploads in their folders; move the sole canonical record back. */
export async function rollbackSessionLayout(baseDir: string): Promise<number> {
  let count = 0;
  for (const recordPath of await listSessionRecordPaths(baseDir)) {
    if (path.basename(recordPath) !== "session.json") continue;
    const directory = path.dirname(recordPath);
    await moveSessionRecord(recordPath, `${directory}.json`);
    count += 1;
  }
  return count;
}
