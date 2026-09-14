import { promises as fs } from "node:fs";
import path from "node:path";
import { pruneSessionDrafts } from "./session-files.js";

async function* directories(directory: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.opendir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for await (const entry of entries)
    if (entry.isDirectory() && !entry.name.startsWith(".")) yield path.join(directory, entry.name);
}
async function hasRecord(directory: string): Promise<boolean> {
  for (const record of [path.join(directory, "session.json"), `${directory}.json`]) {
    try {
      if ((await fs.lstat(record)).isFile()) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return false;
}
/** One worker streams the exact cwd/agent layout, including archives and rollback-retained folders. */
export async function pruneStoredSessionDrafts(input: {
  agentRoot: string;
  temporaryRoot?: string;
  stopped?: () => boolean;
  onError: (error: unknown, directory: string) => void;
}): Promise<void> {
  if (input.temporaryRoot && !input.stopped?.()) {
    try {
      await pruneSessionDrafts(input.temporaryRoot);
    } catch (error) {
      input.onError(error, input.temporaryRoot);
    }
  }
  for await (const cwdDirectory of directories(input.agentRoot))
    for await (const directory of directories(cwdDirectory)) {
      if (input.stopped?.()) return;
      try {
        if (await hasRecord(directory)) await pruneSessionDrafts(directory);
      } catch (error) {
        input.onError(error, directory);
      }
    }
}
export function startSessionFileMaintenance(input: {
  agentRoot: string;
  temporaryRoot?: string;
  onError: (error: unknown, directory: string) => void;
  intervalMs?: number;
}): () => Promise<void> {
  let stopped = false;
  let pending: Promise<void> | undefined;
  const run = () => {
    if (stopped || pending) return;
    pending = pruneStoredSessionDrafts({ ...input, stopped: () => stopped })
      .catch((error: unknown) => input.onError(error, input.agentRoot))
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(run, input.intervalMs ?? 60 * 60 * 1000);
  timer.unref();
  run();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
