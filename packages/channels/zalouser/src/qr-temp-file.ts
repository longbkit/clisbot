// upstream: extensions/zalouser/src/qr-temp-file.ts@5d8067a4483
// D-ZU-006: `resolvePreferredOpenClawTmpDir` is OpenClaw's tmp-root preference
// walk over its own state dir; Fusion's boundary is `fusion/temp-dir.ts`. The
// stable per-profile file name, the base64 decode, the 0600 mode and the
// overwrite-instead-of-accumulate rule are unchanged.
// Zalouser plugin module implements qr temp file behavior.
import fsp from "node:fs/promises";
import path from "node:path";
import { resolveZalouserTmpDir } from "./fusion/temp-dir.js";

export async function writeQrDataUrlToTempFile(
  qrDataUrl: string,
  profile: string,
): Promise<string | null> {
  const trimmed = qrDataUrl.trim();
  const match = trimmed.match(/^data:image\/png;base64,(.+)$/i);
  const base64 = (match?.[1] ?? "").trim();
  if (!base64) {
    return null;
  }
  const safeProfile = profile.replace(/[^a-zA-Z0-9_-]+/g, "-") || "default";
  // The stable private-root name lets QR refreshes overwrite instead of accumulating temp files.
  const filePath = path.join(
    resolveZalouserTmpDir(),
    `openclaw-zalouser-qr-${safeProfile}.png`,
  );
  await fsp.writeFile(filePath, Buffer.from(base64, "base64"), { mode: 0o600 });
  await fsp.chmod(filePath, 0o600);
  return filePath;
}
