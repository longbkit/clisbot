// The real package resolves to Expo module source that needs the native
// runtime (globalThis.expo). Browser tests have no native modules: the
// optional lookup reports none, and the enforcing one stays loud.
export function requireOptionalNativeModule(): null {
  return null;
}
export function requireNativeModule(): never {
  throw new Error("requireNativeModule is unavailable in browser tests");
}
