// Fusion-owned `node:fs` stand-in for `accounts.ts` and `targets-runtime.ts`
// (D-WA-010): the auth-directory listing and the Baileys LID reverse-mapping
// reads, served from the encrypted auth directory (`fusion/auth-fs.ts`).
import { readdirSync, readFileSync } from "./auth-fs.js";

export default { readdirSync, readFileSync };
