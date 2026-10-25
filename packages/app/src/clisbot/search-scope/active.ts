/** Rollback boundary: `EXPO_PUBLIC_CLISBOT_SEARCH_SCOPE=0` restores upstream search exactly. */
export const SEARCH_SCOPE_ENABLED = process.env.EXPO_PUBLIC_CLISBOT_SEARCH_SCOPE !== "0";

/** Host and Project scope runs while search is open, except inside the file scope. */
export function isSearchScopeActive(input: {
  enabled: boolean;
  open: boolean;
  filesScope: boolean;
}): boolean {
  return input.enabled && input.open && !input.filesScope;
}
