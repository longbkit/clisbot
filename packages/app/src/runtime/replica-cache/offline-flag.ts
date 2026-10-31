/**
 * The O2 offline cache slice: compact 256 KB session tails, chat transcript tails, per-tail
 * eviction and Settings → Storage (docs/features/offline/offline-cache.md). Set
 * `EXPO_PUBLIC_CLISBOT_OFFLINE_CACHE=0` to restore the 50-item tail with whole-Host eviction.
 */
export const OFFLINE_CACHE_ENABLED = process.env.EXPO_PUBLIC_CLISBOT_OFFLINE_CACHE !== "0";
