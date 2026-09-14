import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { syncDirectory, writeDurableJson } from "./durable-file.js";
import { assertSessionId } from "./layout.js";

export class SessionDeletedError extends Error {
  constructor(message = "Agent is being deleted") {
    super(message);
    this.name = "SessionDeletedError";
  }
}

function deletedAgentPath(agentRoot: string, agentId: string): string {
  assertSessionId(agentId);
  return path.join(
    agentRoot,
    ".session-deleted-ids",
    createHash("sha256").update(agentId).digest("hex"),
  );
}
export async function assertAgentNotDeleted(agentRoot: string, agentId: string): Promise<void> {
  try {
    await fs.access(deletedAgentPath(agentRoot, agentId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new SessionDeletedError(`Agent ${agentId} is permanently deleted`);
}
export async function persistDeletedAgentId(agentRoot: string, agentId: string): Promise<void> {
  const file = deletedAgentPath(agentRoot, agentId);
  try {
    await fs.access(file);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeDurableJson(file, { version: 1, agentId });
}

function targetName(directory: string): string {
  const target = path.basename(path.resolve(directory));
  if (!target || target.startsWith(".") || /[\\/]/.test(target) || target.includes("\0"))
    throw new Error("Invalid session deletion target");
  return target;
}
export function sessionDeletionIntentPath(directory: string): string {
  const target = targetName(directory);
  return intentPath(directory, target);
}
function intentPath(directory: string, target: string): string {
  return path.join(
    path.dirname(path.resolve(directory)),
    `.deleted-${createHash("sha256").update(target).digest("hex")}`,
  );
}
export async function assertSessionNotDeleted(directory: string): Promise<void> {
  try {
    // Temporary uploads also lease the configured PASEO_HOME (often `.paseo`).
    // Looking for a fence does not authorize deleting that non-agent directory.
    await fs.access(intentPath(directory, path.basename(path.resolve(directory))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new SessionDeletedError();
}
interface DeletionIntent {
  version: 1;
  target: string;
  recordFiles?: string[];
}
function validateRecordPath(
  agentRoot: string,
  parent: string,
  relative: string,
  target: string,
): string {
  const absolute = path.resolve(parent, relative);
  const withinRoot = path.relative(path.resolve(agentRoot), absolute);
  if (
    path.isAbsolute(relative) ||
    withinRoot.startsWith(`..${path.sep}`) ||
    withinRoot === ".." ||
    path.isAbsolute(withinRoot)
  )
    throw new Error("Session deletion record path escapes agent storage");
  if (
    path.basename(absolute) !== `${target}.json` &&
    !(
      path.basename(absolute) === "session.json" && path.basename(path.dirname(absolute)) === target
    )
  )
    throw new Error("Session deletion record path does not match agent identity");
  if (withinRoot.split(path.sep).length > 3)
    throw new Error("Session deletion record path has invalid depth");
  return absolute;
}
export async function writeSessionDeletionIntent(
  directory: string,
  records?: { agentRoot: string; paths: string[] },
): Promise<void> {
  const file = sessionDeletionIntentPath(directory);
  const target = targetName(directory);
  let previous: DeletionIntent | undefined;
  try {
    const metadata = await fs.lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64 * 1024)
      throw new Error("Session deletion intent exceeds byte budget or is not a regular file");
    previous = JSON.parse(await fs.readFile(file, "utf8")) as DeletionIntent;
    if (
      previous.version !== 1 ||
      previous.target !== target ||
      Object.keys(previous).some((key) => !["version", "target", "recordFiles"].includes(key)) ||
      (previous.recordFiles !== undefined &&
        (!Array.isArray(previous.recordFiles) ||
          previous.recordFiles.length > 128 ||
          !previous.recordFiles.every((record) => typeof record === "string")))
    )
      throw new Error("Invalid existing session deletion intent");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const recordFiles = records
    ? records.paths.map((recordPath) => {
        const relative = path.relative(
          path.dirname(path.resolve(directory)),
          path.resolve(recordPath),
        );
        validateRecordPath(records.agentRoot, path.dirname(directory), relative, target);
        return relative;
      })
    : previous?.recordFiles;
  if (
    recordFiles &&
    (recordFiles.length > 128 || Buffer.byteLength(JSON.stringify(recordFiles)) > 60 * 1024)
  )
    throw new Error("Session deletion record paths exceed budget");
  await writeDurableJson(file, { version: 1, target, ...(recordFiles ? { recordFiles } : {}) });
}
async function validateRecord(recordPath: string, agentId: string): Promise<boolean> {
  let stat;
  try {
    stat = await fs.lstat(recordPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
    throw new Error("Invalid record at a session deletion target");
  const record = JSON.parse(await fs.readFile(recordPath, "utf8")) as { id?: unknown };
  if (record.id !== agentId) throw new Error("Session deletion intent does not match its record");
  return true;
}
/** A replayed intent must name exactly the session its own file name hashes to. */
async function readIntent(
  parent: string,
  name: string,
): Promise<{ target: string; recordFiles: string[] }> {
  const file = path.join(parent, name);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024)
    throw new Error("Invalid session deletion intent");
  const value = JSON.parse(await fs.readFile(file, "utf8")) as {
    version?: unknown;
    target?: unknown;
    recordFiles?: unknown;
  };
  if (
    value.version !== 1 ||
    typeof value.target !== "string" ||
    value.target !== targetName(value.target) ||
    Object.keys(value).some((key) => !["version", "target", "recordFiles"].includes(key))
  )
    throw new Error("Invalid session deletion intent identity");
  if (
    value.recordFiles !== undefined &&
    (!Array.isArray(value.recordFiles) ||
      value.recordFiles.length > 128 ||
      !value.recordFiles.every((record) => typeof record === "string"))
  )
    throw new Error("Invalid session deletion record paths");
  if (sessionDeletionIntentPath(path.join(parent, value.target)) !== file)
    throw new Error("Session deletion intent hash does not match target");
  return { target: value.target, recordFiles: (value.recordFiles ?? []) as string[] };
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    if (!(await fs.lstat(directory)).isDirectory())
      throw new Error("Session deletion target is not a directory");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
}

async function removeRecords(records: Iterable<string>, directory: string): Promise<void> {
  for (const recordPath of records) {
    try {
      await fs.unlink(recordPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (path.dirname(recordPath) !== directory) await syncDirectory(path.dirname(recordPath));
  }
}

async function replayIntent(agentRoot: string, parent: string, name: string): Promise<void> {
  const intent = await readIntent(parent, name);
  const directory = path.join(parent, intent.target);
  const recordPaths = intent.recordFiles.map((relative) =>
    validateRecordPath(agentRoot, parent, relative, intent.target),
  );
  const existingRecords: string[] = [];
  for (const recordPath of recordPaths)
    if (await validateRecord(recordPath, intent.target)) existingRecords.push(recordPath);
  const exists = await directoryExists(directory);
  await validateRecord(path.join(directory, "session.json"), intent.target);
  const legacyPath = `${directory}.json`;
  const legacyExists = await validateRecord(legacyPath, intent.target);
  await persistDeletedAgentId(agentRoot, intent.target);
  if (!exists && !legacyExists && !existingRecords.length) return;
  await fs.rm(directory, { recursive: true, force: true });
  await removeRecords(
    new Set([...existingRecords, ...(legacyExists ? [legacyPath] : [])]),
    directory,
  );
  await syncDirectory(parent);
  // The small disk fence remains; no process-local deletion owner is retained.
}
async function replayInDirectory(agentRoot: string, directory: string): Promise<void> {
  let entries;
  try {
    entries = await fs.opendir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for await (const entry of entries)
    if (entry.name.startsWith(".deleted-")) await replayIntent(agentRoot, directory, entry.name);
}
/** Startup only, before loading records or starting writers. Never descend into subagents/uploads. */
export async function replaySessionDeletionIntents(agentRoot: string): Promise<void> {
  agentRoot = path.resolve(agentRoot);
  await replayInDirectory(agentRoot, agentRoot);
  let entries;
  try {
    entries = await fs.opendir(agentRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for await (const entry of entries)
    if (entry.isDirectory() && !entry.name.startsWith("."))
      await replayInDirectory(agentRoot, path.join(agentRoot, entry.name));
}
