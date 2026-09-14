import { promises as fs } from "node:fs";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

export function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)]!;
}
function distribution(values: readonly number[]) {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}
async function processIo(): Promise<Record<string, number> | null> {
  try {
    return Object.fromEntries(
      (await fs.readFile("/proc/self/io", "utf8"))
        .trim()
        .split("\n")
        .map((line) => {
          const [key, value] = line.split(":");
          return [key!, Number(value?.trim())];
        }),
    );
  } catch {
    return null;
  }
}
function delta(left: Record<string, number> | null, right: Record<string, number> | null) {
  return left && right
    ? Object.fromEntries(Object.keys(right).map((key) => [key, right[key]! - (left[key] ?? 0)]))
    : null;
}

export interface PhaseResult {
  name: string;
  milliseconds: number;
  operations: number;
  logicalBytes: number;
  operationsPerSecond: number;
  logicalBytesPerSecond: number;
  acknowledgementMs: ReturnType<typeof distribution>;
  eventLoopMs: { p95: number; max: number; mean: number | null };
  memory: {
    start: NodeJS.MemoryUsage;
    peakHeapUsed: number;
    peakRss: number;
    end: NodeJS.MemoryUsage;
    afterGc: NodeJS.MemoryUsage;
  };
  processIo: Record<string, number> | null;
  resourceUsage: NodeJS.ResourceUsage;
  detail?: unknown;
}
export async function measure(
  name: string,
  operation: (sample: {
    acknowledge(ms: number, bytes: number, records?: number): void;
  }) => Promise<unknown>,
): Promise<PhaseResult> {
  globalThis.gc?.();
  const startMemory = process.memoryUsage();
  let peakHeapUsed = startMemory.heapUsed;
  let peakRss = startMemory.rss;
  const poll = setInterval(() => {
    const memory = process.memoryUsage();
    peakHeapUsed = Math.max(peakHeapUsed, memory.heapUsed);
    peakRss = Math.max(peakRss, memory.rss);
  }, 25);
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const beforeIo = await processIo();
  const acknowledgements: number[] = [];
  let operations = 0;
  let logicalBytes = 0;
  const start = performance.now();
  let detail: unknown;
  try {
    detail = await operation({
      acknowledge(ms, bytes, records = 1) {
        acknowledgements.push(ms);
        logicalBytes += bytes;
        operations += records;
      },
    });
  } finally {
    clearInterval(poll);
    lag.disable();
  }
  const milliseconds = performance.now() - start;
  const end = process.memoryUsage();
  peakHeapUsed = Math.max(peakHeapUsed, end.heapUsed);
  peakRss = Math.max(peakRss, end.rss);
  const afterIo = await processIo();
  globalThis.gc?.();
  return {
    name,
    milliseconds,
    operations,
    logicalBytes,
    operationsPerSecond: operations / (milliseconds / 1000),
    logicalBytesPerSecond: logicalBytes / (milliseconds / 1000),
    acknowledgementMs: distribution(acknowledgements),
    eventLoopMs: {
      p95: lag.percentile(95) / 1e6,
      max: lag.max / 1e6,
      mean: Number.isFinite(lag.mean) ? lag.mean / 1e6 : null,
    },
    memory: { start: startMemory, peakHeapUsed, peakRss, end, afterGc: process.memoryUsage() },
    processIo: delta(beforeIo, afterIo),
    resourceUsage: process.resourceUsage(),
    detail,
  };
}

/** Logical bytes returned by Node fs APIs; /proc distinguishes syscall/cache/device I/O. */
export function instrumentReads() {
  const counts = {
    readBytes: 0,
    reads: 0,
    opens: 0,
    writes: 0,
    writeBytes: 0,
    syncs: 0,
    syncTotalMs: 0,
    syncMaxMs: 0,
  };
  const originalReadFile = fs.readFile.bind(fs);
  const originalWriteFile = fs.writeFile.bind(fs);
  const originalOpen = fs.open.bind(fs);
  fs.writeFile = (async (...args: Parameters<typeof fs.writeFile>) => {
    await originalWriteFile(...args);
    counts.writes += 1;
    const data = args[1];
    if (typeof data === "string" || ArrayBuffer.isView(data))
      counts.writeBytes += Buffer.byteLength(data as string | Uint8Array);
  }) as typeof fs.writeFile;
  fs.readFile = (async (...args: Parameters<typeof fs.readFile>) => {
    const result = await originalReadFile(...args);
    counts.reads += 1;
    counts.readBytes += Buffer.byteLength(result);
    return result;
  }) as typeof fs.readFile;
  fs.open = async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    counts.opens += 1;
    const write = handle.write.bind(handle);
    handle.write = (async (...writeArgs: unknown[]) => {
      const result = (await Reflect.apply(write, handle, writeArgs)) as { bytesWritten: number };
      counts.writes += 1;
      counts.writeBytes += result.bytesWritten;
      return result;
    }) as typeof handle.write;
    const writeFile = handle.writeFile.bind(handle);
    handle.writeFile = async (...writeArgs: Parameters<typeof handle.writeFile>) => {
      await writeFile(...writeArgs);
      counts.writes += 1;
      const data = writeArgs[0];
      if (typeof data === "string" || ArrayBuffer.isView(data))
        counts.writeBytes += Buffer.byteLength(data as string | Uint8Array);
    };
    const read = handle.read.bind(handle);
    handle.read = (async (...readArgs: unknown[]) => {
      const result = (await Reflect.apply(read, handle, readArgs)) as { bytesRead: number };
      counts.reads += 1;
      counts.readBytes += result.bytesRead;
      return result;
    }) as typeof handle.read;
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      const start = performance.now();
      await sync();
      const elapsed = performance.now() - start;
      counts.syncs += 1;
      counts.syncTotalMs += elapsed;
      counts.syncMaxMs = Math.max(counts.syncMaxMs, elapsed);
    };
    return handle;
  };
  return {
    snapshot: () => ({
      readBytes: counts.readBytes,
      reads: counts.reads,
      opens: counts.opens,
      writes: counts.writes,
      writeBytes: counts.writeBytes,
      syncs: counts.syncs,
      syncMeanMs: counts.syncs ? counts.syncTotalMs / counts.syncs : null,
      syncMaxMs: counts.syncMaxMs,
    }),
    reset() {
      counts.readBytes = 0;
      counts.reads = 0;
      counts.opens = 0;
      counts.writes = 0;
      counts.writeBytes = 0;
      counts.syncs = 0;
      counts.syncTotalMs = 0;
      counts.syncMaxMs = 0;
    },
    restore() {
      fs.readFile = originalReadFile;
      fs.writeFile = originalWriteFile;
      fs.open = originalOpen;
    },
  };
}
