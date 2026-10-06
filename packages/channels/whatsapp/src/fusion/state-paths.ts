// Fusion-owned `plugin-sdk/state-paths` for the WhatsApp vertical (D-WA-011).
//
// Upstream roots WhatsApp auth under OpenClaw's OAuth directory and reads LID
// mappings from OpenClaw's config directory. Neither exists in Fusion: the Hub
// owns state, and the linked-device auth lives in the encrypted channel store.
// Both resolve inside the virtual tree `fusion/auth-fs.ts` serves, so the
// ported path arithmetic (`<oauth>/whatsapp/<accountId>`) is unchanged and
// lands on that store.
import path from "node:path";
import { resolveUserPath } from "@clisbot/channels-core/plugin-sdk/text-utility-runtime";
import { WHATSAPP_AUTH_ROOT } from "./auth-fs.js";

export { resolveUserPath };

/** Upstream `resolveOAuthDir()`: the virtual auth root. */
export function resolveOAuthDir(): string {
  return WHATSAPP_AUTH_ROOT;
}

/** Upstream `CONFIG_DIR`: a virtual directory with nothing in it. */
export const CONFIG_DIR = path.join(path.dirname(WHATSAPP_AUTH_ROOT), "config");

/** Upstream `ensureDir` for the auth directory: served by the virtual tree. */
export { ensureDir } from "./auth-fs.js";
