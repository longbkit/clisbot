/** node --expose-gc --import tsx packages/server/scripts/session-storage-benchmark/run.ts */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { SESSION_STORAGE_LIMITS } from "../../src/server/agent/session-storage/paged-journal.js";
import { STORE_ADMISSION_LIMITS } from "../../src/server/agent/session-storage/store-admission.js";
import { instrumentReads, measure, type PhaseResult } from "./metrics.js";
import { directoryBenchmarks } from "./directory.js";
import { command, sourceState } from "./source-state.js";
import { timelineBenchmarks, writerBenchmarks } from "./timeline.js";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}
const smoke = process.argv.includes("--smoke");
const ceiling = process.argv.includes("--ceiling");
const writersOnly = process.argv.includes("--writers-only");
const root = path.resolve(
  option("data", path.join(os.tmpdir(), `session-storage-benchmark-${Date.now()}`)),
);
const output = path.resolve(option("output", path.join(root, "results.json")));
const baselineRoot = option("baseline-root", "");
const samples = smoke ? 2 : Number(option("samples", "20"));
const writerRows = smoke ? 20 : Number(option("writer-rows", "1000"));
const cycles = smoke ? 2 : Number(option("cycles", "6"));
for (const value of [samples, writerRows, cycles]) assert(Number.isSafeInteger(value) && value > 0);
async function optionalFile(file: string) {
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}
/** Required gates are 1,000 and 10,000 rows; 100,000 is an opt-in ceiling diagnostic. */
function benchmarkRows(): number[] {
  if (smoke) return [100];
  return ceiling ? [1000, 10_000, 100_000] : [1000, 10_000];
}
const phases: (PhaseResult | { name: string; error: string })[] = [];
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  endedAt: "",
  smoke,
  sourceStart: sourceState(),
  sourceEnd: {} as ReturnType<typeof sourceState>,
  environment: {
    node: process.version,
    execArgv: process.execArgv,
    platform: process.platform,
    architecture: process.arch,
    kernel: os.release(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    cgroupMemoryMax: await optionalFile("/sys/fs/cgroup/memory.max"),
    filesystem: command("findmnt", [
      "-T",
      path.dirname(root),
      "-o",
      "TARGET,SOURCE,FSTYPE,OPTIONS",
      "-n",
    ]),
    sourceExecution:
      "Production TypeScript via tsx; no browser or provider process in these timings",
    storageMedium: "Container mount reported above; physical device and SSD status not established",
    network: "No network transport",
    cache: "New store owner for cold reads; OS cache remains warm from fixture writes",
  },
  datasets: {
    rows: benchmarkRows(),
    sessions: smoke ? [100] : [1000, 10_000],
    writerCount: 10,
    writerRows,
    samples,
    cycles,
    mixedRowBlock:
      "20 rows: user+sender+attachment path, running/completed tool, reasoning, chunks sharing message IDs",
    attachments:
      "Actual 1KiB uploads/fixture.txt per timeline; ownership/admission not benchmarked",
  },
  limits: {
    ...SESSION_STORAGE_LIMITS,
    fileStoreOwners: 128,
    fileStoreAdmission: STORE_ADMISSION_LIMITS,
    projectionOperationBytes: 16 * 1024 * 1024,
    projectionGlobalBytes: 32 * 1024 * 1024,
  },
  instrumentation:
    "25ms memory samples include harness; post-GC heap requires --expose-gc. /proc/self/io deltas include metric reads and cached syscalls. read_bytes/write_bytes are OS-attributed block IO. Node read counters cover readFile/FileHandle.read, not createReadStream. resourceUsage cumulative.",
  baseline: baselineRoot
    ? {
        root: baselineRoot,
        head: command("git", ["-C", baselineRoot, "rev-parse", "HEAD"]),
        scope:
          "Same legacy metadata and eager in-memory projection only; prior HEAD has no durable journal API. Provider startup not simulated.",
      }
    : { scope: "No baseline root supplied" },
  exclusions: [
    "daemon ingress/staged/steer/provider queues",
    "uploads/subagent caches and deletion tombstones",
    "provider processes",
    "app render/directory wire timing",
    "production/browser/desktop/mobile/relay latency",
    "cold OS cache",
  ],
  phases,
};
const reads = instrumentReads();
async function save() {
  report.endedAt = new Date().toISOString();
  report.sourceEnd = sourceState();
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}
export type Phase = (name: string, operation: Parameters<typeof measure>[1]) => Promise<void>;
const phase: Phase = async (name, operation) => {
  reads.reset();
  process.stdout.write(`Starting ${name}\n`);
  try {
    const result = await measure(name, operation);
    result.detail = { operation: result.detail, nodeIo: reads.snapshot() };
    phases.push(result);
    process.stdout.write(`Completed ${name}: ${result.milliseconds.toFixed(1)} ms\n`);
  } catch (error) {
    phases.push({
      name,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    process.stdout.write(`FAILED ${name}: ${String(error)}\n`);
  }
  await save();
};
export interface BenchmarkContext {
  root: string;
  baselineRoot: string;
  samples: number;
  phase: Phase;
}
await fs.mkdir(root, { recursive: true });
assert(!(await fs.readdir(root)).length, `Benchmark data directory must be empty: ${root}`);
await fs.writeFile(path.join(root, ".session-storage-benchmark"), report.startedAt);
try {
  const context = { root, baselineRoot, samples, phase };
  if (!writersOnly) {
    for (const count of report.datasets.sessions)
      await directoryBenchmarks(context, count, pino({ level: "silent" }));
    for (const count of report.datasets.rows) await timelineBenchmarks(context, count);
  }
  await writerBenchmarks(context, { writerRows, cycles, owners: smoke ? 12 : 160, writersOnly });
} finally {
  reads.restore();
  await save();
}
if (phases.some((entry) => "error" in entry)) process.exitCode = 1;
process.stdout.write(`Report ${output}\n`);
