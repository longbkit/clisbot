import { promises as fs } from "node:fs";
import { SESSION_STORAGE_LIMITS } from "./paged-journal.js";

// Old imports may contain a row larger than today's readable page. Preserve such rows
// during indexing; the page reader still rejects them. Never buffer an unlimited line.
export const INDEX_SCAN_LINE_BYTES = SESSION_STORAGE_LIMITS.readPageBytes * 2;
let scanTail: Promise<void> = Promise.resolve();

export class SessionIndexScanLimitError extends Error {
  constructor(filePath: string, offset: number) {
    super(
      `Session journal row exceeds index scan byte budget (${INDEX_SCAN_LINE_BYTES} bytes): ${filePath} at byte ${offset}`,
    );
  }
}

/** Byte offsets remain exact even when UTF-8 characters or JSON lines span read chunks. */
export async function* scanSessionEventLines(filePath: string, start: number, end: number) {
  if (end <= start) return;
  const previous = scanTail;
  let unlock!: () => void;
  scanTail = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  let handle;
  try {
    handle = await fs.open(filePath, "r");
  } catch (error) {
    unlock();
    throw error;
  }
  let fragments: Buffer[] = [];
  let length = 0;
  let offset = start;
  try {
    for (let position = start; position < end; ) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, end - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) throw new Error("Session journal changed during index scan");
      position += bytesRead;
      const chunk = buffer.subarray(0, bytesRead);
      for (let from = 0; from < chunk.length; ) {
        const newline = chunk.indexOf(10, from);
        const to = newline < 0 ? chunk.length : newline + 1;
        fragments.push(chunk.subarray(from, to));
        length += to - from;
        if (length > INDEX_SCAN_LINE_BYTES) throw new SessionIndexScanLimitError(filePath, offset);
        from = to;
        if (newline < 0) continue;
        const line = Buffer.concat(fragments, length)
          .subarray(0, length - 1)
          .toString("utf8");
        yield { line, offset, length };
        offset += length;
        fragments = [];
        length = 0;
      }
    }
    if (length) yield { line: Buffer.concat(fragments, length).toString("utf8"), offset, length };
  } finally {
    try {
      await handle.close();
    } finally {
      unlock();
    }
  }
}
