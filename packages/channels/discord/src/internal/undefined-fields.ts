// upstream: extensions/discord/src/internal/undefined-fields.ts@5d8067a4483
// Discord plugin module implements undefined field filtering.
export function stripUndefinedFields<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
