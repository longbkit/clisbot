import * as SecureStore from "expo-secure-store";

export function readSecret(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export function writeSecret(key: string, value: string): Promise<void> {
  return SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export function deleteSecret(key: string): Promise<void> {
  return SecureStore.deleteItemAsync(key);
}

const operations = new Map<string, Promise<unknown>>();
export async function lockSecret<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = operations.get(key);
  const next = (previous?.catch(() => undefined) ?? Promise.resolve()).then(action);
  operations.set(key, next);
  try {
    return await next;
  } finally {
    if (operations.get(key) === next) operations.delete(key);
  }
}
