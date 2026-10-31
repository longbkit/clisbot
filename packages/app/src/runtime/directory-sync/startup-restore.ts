import type { CachedDirectory } from "@/runtime/replica-cache";
import type { RestoreSlicer } from "@/runtime/replica-cache/restore-slicer";

/** What the startup restore needs from a Host's directory sync. */
export interface StartupRestoreDirectory {
  /**
   * Loads of this Host's cache wait for `restored` instead of reading the cache again. It
   * resolves false when the restore did not apply this Host's cache, so the Host reads it itself.
   */
  adoptCacheRestore(restored: Promise<boolean>): void;
  cacheReadRevision(): number;
  applyCachedDirectory(cached: CachedDirectory, readRevision: number): void;
}

export interface StartupRestoreTarget {
  serverId: string;
  directory: StartupRestoreDirectory;
}

export interface StartupRestoreDeps {
  read: (serverId: string, slicer: RestoreSlicer) => Promise<CachedDirectory>;
  slicer: RestoreSlicer;
  yieldToEventLoop: () => Promise<void>;
  /** Publishes every store write inside `apply` as one notification. */
  commit: (apply: () => void) => void;
  afterNextFrame: (run: () => void) => void;
  onFirstCachedFrame: () => void;
  now: () => number;
}

/**
 * The longest a read Host waits for its commit. Committing only the first Host and then all the
 * others at the end left a Galaxy S23's Home empty until the whole 4.5 s restore finished.
 */
const COMMIT_INTERVAL_MS = 400;

interface RestoredHost {
  directory: StartupRestoreDirectory;
  cached: CachedDirectory;
  readRevision: number;
}

/**
 * Restores every Host's cached directory after the startup connects went out: one Host at a time,
 * its rows parsed in the slicer's chunks, a macrotask between chunks and Hosts. Each commit of a
 * Host's directory re-runs every derivation over all Hosts, so the first Host commits alone (the
 * first cached frame) and the rest commit together at most every `COMMIT_INTERVAL_MS`
 * (docs/features/offline/connection-resilience.md#cold-start-js-thread).
 */
export async function restoreCachedDirectories(
  targets: readonly StartupRestoreTarget[],
  deps: StartupRestoreDeps,
): Promise<void> {
  const settles = targets.map(({ directory }) => {
    let settle: (applied: boolean) => void = () => undefined;
    directory.adoptCacheRestore(new Promise<boolean>((resolve) => (settle = resolve)));
    return settle;
  });
  try {
    await deps.yieldToEventLoop();
    let pending: number[] = [];
    let restored: RestoredHost[] = [];
    let lastCommit: number | undefined;
    for (const [index, target] of targets.entries()) {
      const host = await readHost(target, deps);
      if (host) {
        restored.push(host);
        pending.push(index);
      } else settles[index]!(false);
      await deps.slicer.pause();
      const due = lastCommit === undefined || deps.now() - lastCommit >= COMMIT_INTERVAL_MS;
      if (!due && index < targets.length - 1) continue;
      if (!restored.length) continue;
      commitRestored(restored, deps);
      for (const done of pending) settles[done]!(true);
      if (lastCommit === undefined) deps.afterNextFrame(deps.onFirstCachedFrame);
      lastCommit = deps.now();
      pending = [];
      restored = [];
      await deps.yieldToEventLoop();
    }
  } finally {
    for (const settle of settles) settle(false);
  }
}

/**
 * One Host's cached directory, or null when its rows cannot be read. A storage error is that
 * Host's alone: it ended the whole restore before, and every Host after it showed no cached
 * sessions until it connected.
 */
async function readHost(
  { serverId, directory }: StartupRestoreTarget,
  deps: StartupRestoreDeps,
): Promise<RestoredHost | null> {
  const readRevision = directory.cacheReadRevision();
  try {
    return { directory, cached: await deps.read(serverId, deps.slicer), readRevision };
  } catch (error) {
    console.warn(`[HostRuntime] Failed to restore the cached directory of ${serverId}`, error);
    return null;
  }
}

function commitRestored(restored: readonly RestoredHost[], deps: StartupRestoreDeps): void {
  deps.slicer.begin();
  deps.commit(() => {
    for (const host of restored)
      host.directory.applyCachedDirectory(host.cached, host.readRevision);
  });
  deps.slicer.end();
}
