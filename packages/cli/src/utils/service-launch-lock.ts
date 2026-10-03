import lockfile from "proper-lockfile";

export async function withServiceLaunchLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const release = await lockfile.lock(file, {
    realpath: false,
    stale: 30_000,
    update: 10_000,
    retries: { retries: 240, factor: 1, minTimeout: 500, maxTimeout: 500 },
  });
  try {
    return await action();
  } finally {
    await release();
  }
}
