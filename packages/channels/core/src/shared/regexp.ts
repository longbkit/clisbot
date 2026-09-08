// upstream: src/shared/regexp.ts@5d8067a4483
/** Escape text so it can be embedded literally inside a RegExp pattern. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
