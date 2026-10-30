import type { CachedDirectory } from "@/runtime/replica-cache";
import type { RestoreSlicer } from "@/runtime/replica-cache/restore-slicer";

/** What the startup restore needs from a Host's directory sync. */
export interface StartupRestoreDirectory {
  /** Loads of this Host's cache wait for `restored` instead of reading the cache again. */
  adoptCacheRestore(restored: Promise<void>): void;
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
}

/** Hosts committed before the others, so the first screen paints from the cache early. */
const FIRST_GROUP_HOSTS = 1;

interface RestoredHost {
  directory: StartupRestoreDirectory;
  cached: CachedDirectory;
  readRevision: number;
}

/**
 * Restores every Host's cached directory after the startup connects went out: one Host at a time,
 * its rows parsed in the slicer's chunks, a macrotask between chunks and Hosts. Each commit of a
 * Host's directory re-runs every derivation over all Hosts, so the first Host commits alone (the
 * first cached frame) and the rest commit together
 * (docs/features/offline/connection-resilience.md#cold-start-js-thread).
 */
export async function restoreCachedDirectories(
  targets: readonly StartupRestoreTarget[],
  deps: StartupRestoreDeps,
): Promise<void> {
  const settles = targets.map(({ directory }) => {
    let settle = () => undefined as void;
    directory.adoptCacheRestore(new Promise<void>((resolve) => (settle = resolve)));
    return settle;
  });
  try {
    await deps.yieldToEventLoop();
    const groups = [targets.slice(0, FIRST_GROUP_HOSTS), targets.slice(FIRST_GROUP_HOSTS)];
    for (const [index, group] of groups.entries()) {
      if (group.length === 0) continue;
      const restored = await readGroup(group, deps);
      deps.slicer.begin();
      deps.commit(() => {
        for (const host of restored)
          host.directory.applyCachedDirectory(host.cached, host.readRevision);
      });
      deps.slicer.end();
      for (const target of group) settles[targets.indexOf(target)]!();
      if (index === 0) deps.afterNextFrame(deps.onFirstCachedFrame);
      await deps.yieldToEventLoop();
    }
  } finally {
    for (const settle of settles) settle();
  }
}

async function readGroup(
  group: readonly StartupRestoreTarget[],
  deps: StartupRestoreDeps,
): Promise<RestoredHost[]> {
  const restored: RestoredHost[] = [];
  for (const { serverId, directory } of group) {
    const readRevision = directory.cacheReadRevision();
    const cached = await deps.read(serverId, deps.slicer);
    restored.push({ directory, cached, readRevision });
    await deps.slicer.pause();
  }
  return restored;
}
