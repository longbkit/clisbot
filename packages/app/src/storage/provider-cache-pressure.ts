/** Disposable catalog storage only. Never reclaim other branded app data. */
export interface ProviderCacheStorage {
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys?(): Promise<readonly string[]>;
  multiRemove?(keys: readonly string[]): Promise<void>;
}

const currentBodyPrefix = "@clisbot/provider-snapshot/v2:";
// COMPAT(providerCatalogBrand): added after v2.1.1 on 2026-10-15. Remove after
// 2027-04-15 once pre-rebrand clients (including still-open tabs) are unsupported.
const legacyBodyPrefixes = ["@paseo/provider-snapshot/v2:", "@clisbot/provider-snapshot/v1:"];
const legacyIndexKeys = new Set([
  "@paseo/provider-snapshot-index/v2",
  "@clisbot/provider-snapshot-index/v1",
]);
const currentIndexKey = "@clisbot/provider-snapshot-index/v2";
const queues = new WeakMap<ProviderCacheStorage, Promise<unknown>>();

export function isStorageQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = error as { name?: string; code?: number | string; message?: string };
  return (
    detail.name === "QuotaExceededError" ||
    detail.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    detail.code === 22 ||
    detail.code === 1014 ||
    detail.code === "SQLITE_FULL" ||
    /database or disk is full/i.test(detail.message ?? "")
  );
}

export function isObsoleteProviderCatalogKey(key: string): boolean {
  return legacyBodyPrefixes.some((prefix) => key.startsWith(prefix)) || legacyIndexKeys.has(key);
}

async function removeCatalogs(
  storage: ProviderCacheStorage,
  includeCurrent: boolean,
): Promise<void> {
  if (!storage.getAllKeys) return;
  const keys = (await storage.getAllKeys()).filter(
    (key) =>
      isObsoleteProviderCatalogKey(key) ||
      (includeCurrent && (key.startsWith(currentBodyPrefix) || key === currentIndexKey)),
  );
  if (!keys.length) return;
  if (storage.multiRemove) await storage.multiRemove(keys);
  else for (const key of keys) await storage.removeItem(key);
}

/** Serialize this app's catalog and registry writes; other tabs can still consume quota. */
export function withProviderCacheRecovery<T>(
  storage: ProviderCacheStorage,
  operation: () => Promise<T>,
  onReclaim: () => void = () => undefined,
): Promise<T> {
  const result = (queues.get(storage) ?? Promise.resolve()).then(async () => {
    // No permanent migration marker: a still-open older tab may write these again.
    await removeCatalogs(storage, false);
    try {
      return await operation();
    } catch (error) {
      if (!isStorageQuotaError(error)) throw error;
      await removeCatalogs(storage, true);
      onReclaim();
      return await operation(); // One retry only, even if an older tab races reclamation.
    }
  });
  queues.set(
    storage,
    result.catch(() => undefined),
  );
  return result;
}

export async function persistHostRegistry(
  storage: ProviderCacheStorage,
  key: string,
  value: string,
): Promise<void> {
  try {
    await withProviderCacheRecovery(storage, () => storage.setItem(key, value));
  } catch (error) {
    if (!isStorageQuotaError(error)) throw error;
    throw new Error(
      "Could not save Host connections: device storage is full. Free storage for this app, then retry. Existing saved connections were kept.",
      { cause: error },
    );
  }
}
