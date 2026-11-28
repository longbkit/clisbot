// The package ships JSX in .js files, which the dependency optimizer cannot parse.
// expo-clipboard resolves to the Expo module source, which needs the native
// runtime (globalThis.expo). The web DOM exposes the same capability, so back
// the string API with it; web tests never exercise async image payloads.
export async function getStringAsync(): Promise<string> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return "";
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}
export async function setStringAsync(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return true;
  // Headless browsers deny clipboard writes without a user gesture; the copy
  // affordances under test only need a no-op that does not throw. Like the
  // native module, report success.
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // ignored
  }
  return true;
}
export async function hasStringAsync(): Promise<boolean> {
  return (await getStringAsync()).length > 0;
}
