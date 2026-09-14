// expo-file-system/legacy — the classic namespace API the app's attachment and
// download paths reference. No file I/O runs in browser tests, so every method
// rejects / returns an empty shape; only the module-load surface matters.
export const EncodingType = {
  UTF8: "utf8",
  Base64: "base64",
  UTF16: "utf16",
  UTF32: "utf32",
} as const;

export const cacheDirectory = "";
export const documentDirectory = "";
export const bundleDirectory = "";

export async function getInfoAsync(): Promise<{ exists: boolean }> {
  return { exists: false };
}
export async function makeDirectoryAsync(): Promise<unknown> {
  return undefined;
}
export async function copyAsync(): Promise<unknown> {
  return undefined;
}
export async function readAsStringAsync(): Promise<string> {
  return "";
}
export async function readDirectoryAsync(): Promise<string[]> {
  return [];
}
export async function deleteAsync(): Promise<unknown> {
  return undefined;
}
export function createDownloadResumable(): { remove: () => void } {
  return { remove: () => undefined };
}
