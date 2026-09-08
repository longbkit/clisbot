// Fusion-owned host adapter for `src/infra/fs-safe.ts` (D-CORE-059).
//
// Upstream's facade wraps `@openclaw/fs-safe`: OpenClaw's rooted filesystem with
// atomic writes, locks, secure temp files and a `root()` handle that scopes every
// path operation. Fusion's channel plane does not own a filesystem root; the Hub
// checks containment against the reply capability's Project root before any file
// reaches this layer. Only the `root()` handle shape the ported media params use
// is carried, over plain `node:fs`.
import { readFile } from "node:fs/promises";
import path from "node:path";

export type FsSafeRoot = {
  resolve: (target: string) => string;
  readFile: (target: string) => Promise<Buffer>;
  /** Bounded read used by the ported media params to honor a size ceiling. */
  readBytes: (target: string, options?: { maxBytes?: number }) => Promise<Buffer>;
};

/** A rooted handle over plain fs; containment is the Hub's check, not this layer's. */
export function root(rootDir: string): Promise<FsSafeRoot> {
  const base = path.resolve(rootDir);
  return Promise.resolve({
    resolve: (target: string) => path.resolve(base, target),
    readFile: async (target: string) => await readFile(path.resolve(base, target)),
    readBytes: async (target: string, options?: { maxBytes?: number }) => {
      const contents = await readFile(path.resolve(base, target));
      const maxBytes = options?.maxBytes;
      if (maxBytes !== undefined && contents.byteLength > maxBytes) {
        throw new Error(`File is larger than the ${maxBytes} byte limit: ${target}`);
      }
      return contents;
    },
  });
}
