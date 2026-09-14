import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import type { Logger } from "pino";
import { AgentStorage, type StoredAgentRecord } from "../../src/server/agent/agent-storage.js";
import { aggregateWorkspaceAuthorship } from "../../src/server/agent/session-authorship.js";
import { metadataRecord } from "./fixtures.js";
import type { BenchmarkContext } from "./run.js";

export async function parallelIndices(
  count: number,
  concurrency: number,
  operation: (index: number) => Promise<void>,
) {
  let next = 0;
  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = next++;
        if (index >= count) return;
        await operation(index);
      }
    }),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
function aggregate(records: readonly StoredAgentRecord[]) {
  const grouped = new Map<string, StoredAgentRecord[]>();
  for (const record of records) {
    const key = record.workspaceId!;
    const rows = grouped.get(key) ?? [];
    rows.push(record);
    grouped.set(key, rows);
  }
  let participants = 0;
  let channels = 0;
  for (const entries of grouped.values()) {
    const summary = aggregateWorkspaceAuthorship(
      { createdBy: entries[0]!.createdBy, createdAt: entries[0]!.createdAt },
      entries,
    );
    participants += summary.participantActors?.length ?? 0;
    channels += summary.channels?.length ?? 0;
  }
  return {
    workspaceCount: grouped.size,
    participantSnapshots: participants,
    channelReferences: channels,
    includesArchivedSessions: true,
  };
}
export async function directoryBenchmarks(
  context: BenchmarkContext,
  count: number,
  logger: Logger,
) {
  const { root, baselineRoot, phase } = context;
  const directory = path.join(root, `metadata-${count}`, "agents");
  await fs.mkdir(directory, { recursive: true });
  // Fixture construction is outside measured phases and is not a durable-ack claim.
  await parallelIndices(count, 8, async (index) => {
    await fs.writeFile(
      path.join(directory, `agent-${index}.json`),
      JSON.stringify(metadataRecord(index)),
    );
  });
  if (baselineRoot) {
    const module = (await import(
      pathToFileURL(path.join(baselineRoot, "packages/server/src/server/agent/agent-storage.ts"))
        .href
    )) as typeof import("../../src/server/agent/agent-storage.js");
    await phase(`baseline.metadata.legacy.load.${count}`, async (sample) => {
      const start = performance.now();
      const records = await new module.AgentStorage(directory, logger).list();
      assert.equal(records.length, count);
      sample.acknowledge(performance.now() - start, 0, count);
      return { count, baselineStripsNewAuthorshipFields: true };
    });
  }
  await phase(`current.metadata.legacy.load.${count}`, async (sample) => {
    const start = performance.now();
    const records = await new AgentStorage(directory, logger).list();
    assert.equal(records.length, count);
    sample.acknowledge(
      performance.now() - start,
      Buffer.byteLength(JSON.stringify(records)),
      count,
    );
    return { count, metadataRetained: true };
  });
  await phase(`current.metadata.migrate.${count}`, async (sample) => {
    const original = await fs.readFile(path.join(directory, "agent-0.json"));
    const storage = new AgentStorage(directory, logger, { sessionLayout: true });
    const start = performance.now();
    const records = await storage.list();
    assert.equal(records.length, count);
    sample.acknowledge(
      performance.now() - start,
      Buffer.byteLength(JSON.stringify(records)),
      count,
    );
    const migrated = await fs.readFile(
      path.join(await storage.getSessionDirectory("agent-0"), "session.json"),
    );
    assert(original.equals(migrated));
    return { rawBytesSampleVerified: true };
  });
  await phase(`current.metadata.session-layout.load.${count}`, async (sample) => {
    const start = performance.now();
    const records = await new AgentStorage(directory, logger).list();
    assert.equal(records.length, count);
    sample.acknowledge(
      performance.now() - start,
      Buffer.byteLength(JSON.stringify(records)),
      count,
    );
    return { count };
  });
  const retained = new AgentStorage(directory, logger);
  await retained.list();
  await phase(`current.metadata.warm-directory-aggregation.${count}`, async (sample) => {
    let result: ReturnType<typeof aggregate> | null = null;
    for (let iteration = 0; iteration < context.samples; iteration++) {
      const start = performance.now();
      result = aggregate(await retained.list());
      sample.acknowledge(performance.now() - start, 0);
    }
    return {
      ...result,
      scope:
        "AgentStorage metadata + production authorship aggregation, excludes git/provider/wire/UI directory stages",
    };
  });
}
