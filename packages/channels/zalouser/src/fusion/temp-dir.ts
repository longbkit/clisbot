// Fusion-owned boundary for `openclaw/plugin-sdk/temp-path` (D-ZU-006).
//
// Upstream's `resolvePreferredOpenClawTmpDir` walks OpenClaw's own preference
// order — the configured OpenClaw tmp root, then the state dir, then the OS
// temp dir — and creates the directory with private permissions. Fusion has no
// OpenClaw state dir, and the only caller (`qr-temp-file.ts`) needs one thing:
// a private directory to drop the QR PNG in so an operator on the host can open
// it. So the boundary keeps the call shape and the private-directory guarantee
// over `os.tmpdir()`, with `ZALOUSER_TMP_DIR` as the operator override.
//
// The QR image is ALSO returned as a data URL by the QR-setup entry points
// (`fusion/qr-setup.ts`), which is what the app renders; the temp file is the
// host-side convenience upstream's CLI login prints.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The directory QR PNGs are written to. Created 0700 when missing. */
export function resolveZalouserTmpDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ZALOUSER_TMP_DIR?.trim();
  const dir = configured && configured !== "" ? configured : path.join(os.tmpdir(), "paseo-zalouser");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
