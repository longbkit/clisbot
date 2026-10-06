// Fusion-owned `node:fs/promises` stand-in for `auth-store.ts` and
// `connection-owner.ts` (D-WA-010):
// the members that file calls, served from the encrypted auth directory
// (`fusion/auth-fs.ts`). Imported under upstream's `fs` binding.
import { ensureDir, lstat, readdir, readFile, realpath, rm, writeFile } from "./auth-fs.js";

/** `fs.mkdir(dir, { recursive: true })` on the virtual tree. */
async function mkdir(dir: string, _options?: { recursive?: boolean }): Promise<void> {
  await ensureDir(dir);
}

export default { lstat, mkdir, readdir, readFile, realpath, rm, writeFile };
