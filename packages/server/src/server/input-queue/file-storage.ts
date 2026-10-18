import { QueueSnapshotSchema } from "./input-queue-store.js";
import { StoredQueueContentSchema } from "./content.js";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { writeJsonFileAtomic } from "../atomic-file.js";
import type { QueueStorage } from "./input-queue-store.js";

export function queueFileStorage(directory: string): QueueStorage {
  const file = path.join(directory, "queue.json");
  return {
    async read() {
      try {
        if ((await stat(file)).size > 2 * 1024 * 1024)
          throw new Error("Queue snapshot exceeds metadata limit");
        return JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error; // Corruption is never an empty queue.
      }
    },
    write: (snapshot) => writeJsonFileAtomic(file, snapshot),
  };
}

/** Read-only retention protection, including when the runtime feature is disabled. */
export async function queuedAttachmentIds(directory: string): Promise<Set<string>> {
  const raw = await queueFileStorage(directory).read();
  const retained = new Set<string>();
  if (raw === null) return retained;
  for (const item of QueueSnapshotSchema.parse(raw).items)
    for (const file of StoredQueueContentSchema.parse(item.payload).files) retained.add(file.id);
  return retained;
}
