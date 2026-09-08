// upstream: src/test-utils/env.ts@5d8067a4483 (the env capture/restore helpers)
// Test helpers for environment variable setup and restoration.

/** Sets a test-owned env key; callers must capture/restore the key scope. */
export function setTestEnvValue(key: string, value: string): void {
  Reflect.set(process.env, key, value);
}

/** Deletes a test-owned env key; callers must capture/restore the key scope. */
export function deleteTestEnvValue(key: string): void {
  Reflect.deleteProperty(process.env, key);
}

/** Captures selected process.env keys so tests can restore exact prior state. */
export function captureEnv(keys: string[]) {
  const snapshot = new Map<string, string | undefined>();
  for (const key of keys) {
    snapshot.set(key, process.env[key]);
  }

  return {
    restore() {
      for (const [key, value] of snapshot) {
        if (value === undefined) {
          deleteTestEnvValue(key);
        } else {
          setTestEnvValue(key, value);
        }
      }
    },
  };
}
