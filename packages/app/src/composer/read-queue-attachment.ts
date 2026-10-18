import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { InputQueueCommand } from "@clisbot/protocol/input-queue";
export type QueueResult = Omit<
  Awaited<ReturnType<DaemonClient["executeAgentQueueCommand"]>>,
  "agentId"
>;
/** Copy bounded chunks before opening an editor; no Host edit state. */
export async function readQueueAttachment(
  execute: (command: InputQueueCommand) => Promise<QueueResult>,
  id: string,
  fileId: string,
  size: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(size) || size < 0 || size > 50 * 1024 * 1024)
    throw new Error("Queued file is unavailable");
  const bytes = new Uint8Array(size);
  let offset = 0;
  do {
    const operation = { action: "read_file", id, fileId, offset } as const;
    const result = await execute(operation);
    if (result.error || !result.fileChunk)
      throw new Error(result.error ?? "Queued file is unavailable");
    const chunk = atob(result.fileChunk.data);
    if (offset + chunk.length > size || (!chunk.length && !result.fileChunk.done))
      throw new Error("Invalid queued file chunk");
    for (let index = 0; index < chunk.length; index++)
      bytes[offset + index] = chunk.charCodeAt(index);
    offset += chunk.length;
    if (result.fileChunk.done) {
      if (offset !== size) throw new Error("Queued file is incomplete");
      return bytes;
    }
  } while (offset < size);
  throw new Error("Queued file is incomplete");
}
