/** Real rollback CLI plus HEAD's record reader; run only on this generated fixture. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import pino from "pino";
import { AgentStorage } from "../../src/server/agent/agent-storage.js";
import { FileAgentTimelineStore } from "../../src/server/agent/session-storage/file-agent-timeline-store.js";
import { metadataRecord, mixedRow } from "./fixtures.js";

const baselineRoot = process.argv[2];
assert(baselineRoot, "Supply the detached baseline checkout path");
const home = await fs.mkdtemp(path.join(os.tmpdir(), "session-storage-rollback-proof-"));
const directory = path.join(home, "agents");
await fs.mkdir(directory);
const bytes = `${JSON.stringify({ ...metadataRecord(0), futureField: { preserved: true } }, null, 2)}\n`;
await fs.writeFile(path.join(directory, "agent-0.json"), bytes);
const logger = pino({ level: "silent" });
const current = new AgentStorage(directory, logger, { sessionLayout: true });
await current.initialize();
const sessionDirectory = await current.getSessionDirectory("agent-0");
const timeline = new FileAgentTimelineStore(async () => sessionDirectory);
await timeline.bulkInsert("agent-0", [mixedRow(1)]);
const epoch = await timeline.getEpoch("agent-0");
await fs.mkdir(path.join(sessionDirectory, "uploads"));
await fs.writeFile(path.join(sessionDirectory, "uploads", "fixture.txt"), "retained bytes");
await current.flush();
const cli = path.resolve("packages/server/scripts/rollback-session-layout.ts");
const args = ["--import", "tsx", cli, directory, "--daemon-stopped"];
const result = await promisify(execFile)(process.execPath, args, { cwd: process.cwd() });
assert.equal(await fs.readFile(`${sessionDirectory}.json`, "utf8"), bytes);
assert.equal(
  await fs.readFile(path.join(sessionDirectory, "uploads", "fixture.txt"), "utf8"),
  "retained bytes",
);
const baseline = (await import(
  pathToFileURL(path.join(baselineRoot, "packages/server/src/server/agent/agent-storage.ts")).href
)) as typeof import("../../src/server/agent/agent-storage.js");
const records = await new baseline.AgentStorage(directory, logger).list();
assert.equal(records.length, 1);
assert.equal(records[0]!.id, "agent-0");
const restored = new FileAgentTimelineStore(async () => sessionDirectory);
assert.equal(await restored.getEpoch("agent-0"), epoch);
assert.deepEqual((await restored.fetchCommitted("agent-0", { limit: 1 })).rows, [mixedRow(1)]);
const report = {
  home,
  command: [process.execPath, ...args],
  stdout: result.stdout.trim(),
  oldReaderCount: records.length,
  exactOriginalRecordBytesRetained: true,
  uploadsRetained: true,
  currentJournalReadableAfterRollback: true,
  epoch,
  limitation:
    "HEAD AgentStorage source executed with shared installed dependencies. Not a packaged old daemon/browser launch, and old code cannot read new journal APIs.",
};
await fs.writeFile(path.join(home, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
