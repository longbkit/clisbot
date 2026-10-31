import { Directory, File as FSFile, Paths } from "expo-file-system";
import { isWeb } from "@/constants/platform";

/**
 * Native downloads land in their own cache folder so Settings → Storage can measure and clear
 * them; the browser and the desktop app save through the browser and keep nothing here.
 */
const DOWNLOADS_FOLDER = "clisbot-downloads";

function downloadsDirectory(): Directory {
  const base = Paths.cache ?? Paths.document;
  if (!base) throw new Error("No download directory available.");
  return new Directory(base, DOWNLOADS_FOLDER);
}

function sanitizeDownloadFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "download";
  }
  return trimmed.replace(/[\\/:*?"<>|]+/g, "_");
}

function splitFileName(fileName: string): { base: string; ext: string } {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) {
    return { base: fileName, ext: "" };
  }
  return {
    base: fileName.slice(0, lastDot),
    ext: fileName.slice(lastDot),
  };
}

/** A new file in the downloads folder; an existing name gets a ` (n)` suffix. */
export function downloadTargetFile(fileName: string): FSFile {
  const directory = downloadsDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const safeName = sanitizeDownloadFileName(fileName);
  const split = splitFileName(safeName);
  let targetFile = new FSFile(directory, safeName);
  let suffix = 1;

  while (targetFile.exists) {
    targetFile = new FSFile(directory, `${split.base} (${suffix})${split.ext}`);
    suffix += 1;
  }

  return targetFile;
}

export function downloadedFilesBytes(): number {
  if (isWeb) return 0;
  return downloadsDirectory().size ?? 0;
}

/** Throws when the folder exists but cannot be deleted. */
export function clearDownloadedFiles(): void {
  if (isWeb) return;
  const directory = downloadsDirectory();
  if (directory.exists) directory.delete();
}
