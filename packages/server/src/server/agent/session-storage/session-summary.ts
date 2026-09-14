import { createHash } from "node:crypto";
import { z } from "zod";
import { SessionAuthorshipShape } from "@getpaseo/protocol/session-authorship";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  SessionAuthorship,
  AgentPermissionResponseRecord,
} from "@getpaseo/protocol/session-authorship";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { recordSessionInteraction } from "../session-authorship.js";
import {
  SESSION_STORAGE_LIMITS,
  type JournalEntry,
  type JournalOperation,
} from "./paged-journal.js";
import type { SessionEventState, SessionEventStream } from "./session-event-log.js";

interface SourceCursor {
  epoch: string;
  maxSeq: number;
  revision: number;
}
interface InteractionPosition {
  timestamp: string;
  order: number;
}
interface SummaryCheckpoint {
  version: 2;
  timeline: SourceCursor;
  permissions: SourceCursor;
  summary: SessionAuthorship;
  lastInteraction?: InteractionPosition;
  lastMessage?: InteractionPosition;
}
export interface DurableSessionSummary {
  summary: SessionAuthorship;
  watermark: string;
}
const cursorSchema = z.object({
  epoch: z.string().min(1),
  maxSeq: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
});
const positionSchema = z.object({ timestamp: z.string(), order: z.number().int().nonnegative() });
const checkpointSchema = z.object({
  version: z.literal(2),
  timeline: cursorSchema,
  permissions: cursorSchema,
  summary: z.object(SessionAuthorshipShape),
  lastInteraction: positionSchema.optional(),
  lastMessage: positionSchema.optional(),
});
const MAX_SUMMARY_BYTES = 1024 * 1024;
const REPLAY_PAGE_ROWS = 128;

function cursor(value: SessionEventState): SourceCursor {
  return { epoch: value.epoch, maxSeq: value.maxSeq, revision: value.revision };
}
function sameCursor(left: SourceCursor, right: SourceCursor): boolean {
  return (
    left.epoch === right.epoch && left.maxSeq === right.maxSeq && left.revision === right.revision
  );
}
function newer(operation: JournalOperation, previous?: InteractionPosition): boolean {
  return (
    !previous ||
    operation.timestamp > previous.timestamp ||
    (operation.timestamp === previous.timestamp && operation.order > previous.order)
  );
}
function apply(
  checkpoint: SummaryCheckpoint,
  operation: JournalOperation,
  kind: "message" | "permission",
): void {
  // Physical acknowledgement order must not make an older approval replace a newer chat.
  recordSessionInteraction(checkpoint.summary, { ...operation, timestamp: "", kind: "permission" });
  if (newer(operation, checkpoint.lastInteraction)) {
    checkpoint.lastInteraction = { timestamp: operation.timestamp, order: operation.order };
    checkpoint.summary.lastInteractionAt = operation.timestamp;
    checkpoint.summary.lastInteractionBy = operation.actor;
  }
  if (kind === "message" && newer(operation, checkpoint.lastMessage)) {
    checkpoint.lastMessage = { timestamp: operation.timestamp, order: operation.order };
    checkpoint.summary.lastMessageBy = operation.actor;
  }
}
function parseCheckpoint(value: unknown): SummaryCheckpoint | undefined {
  const parsed = checkpointSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function requiresRebuild(saved: SourceCursor, head: SourceCursor): boolean {
  return (
    saved.epoch !== head.epoch || saved.revision !== head.revision || saved.maxSeq > head.maxSeq
  );
}

/** Bound replay by bytes as well as rows; corruption is never treated as a short page. */
async function replayPage<T>(
  stream: SessionEventStream<T>,
  start: number,
  end: number,
): Promise<JournalEntry<T>[]> {
  let boundedEnd = Math.min(end, start + REPLAY_PAGE_ROWS - 1);
  while (true) {
    try {
      return await stream.read(start, boundedEnd);
    } catch (error) {
      if (
        boundedEnd <= start ||
        !(error instanceof Error) ||
        error.message !== "Session page exceeds byte budget; request a smaller page"
      )
        throw error;
      boundedEnd = start + Math.floor((boundedEnd - start) / 2);
    }
  }
}

/** Called under the store's per-session lease. Only lagging pages are replayed. */
export async function recoverSessionSummary(
  timeline: SessionEventStream<AgentTimelineRow>,
  permissions: SessionEventStream<AgentPermissionResponseRecord>,
): Promise<DurableSessionSummary> {
  const head = cursor(await timeline.state());
  const permissionHead = cursor(await permissions.state());
  let checkpoint = parseCheckpoint(await timeline.owner.readSummary());
  if (
    checkpoint &&
    sameCursor(checkpoint.timeline, head) &&
    sameCursor(checkpoint.permissions, permissionHead)
  )
    return result(checkpoint);
  if (
    !checkpoint ||
    requiresRebuild(checkpoint.timeline, head) ||
    requiresRebuild(checkpoint.permissions, permissionHead)
  ) {
    checkpoint = {
      version: 2,
      timeline: { ...head, maxSeq: 0 },
      permissions: { ...permissionHead, maxSeq: 0 },
      summary: { participantActors: [], channels: [] },
    };
  }
  for (let seq = checkpoint.timeline.maxSeq + 1; seq <= head.maxSeq; ) {
    const entries = await replayPage(timeline, seq, head.maxSeq);
    if (!entries.length) throw new Error("Session summary timeline replay made no progress");
    seq = entries.at(-1)!.seq + 1;
    for (const entry of entries)
      if (entry.value.item.type === "user_message" && entry.operation)
        apply(checkpoint, entry.operation, "message");
  }
  for (let seq = checkpoint.permissions.maxSeq + 1; seq <= permissionHead.maxSeq; ) {
    const entries = await replayPage(permissions, seq, permissionHead.maxSeq);
    if (!entries.length) throw new Error("Session summary permission replay made no progress");
    seq = entries.at(-1)!.seq + 1;
    for (const entry of entries)
      if (entry.value.status === "applied" && entry.operation)
        apply(checkpoint, entry.operation, "permission");
  }
  checkpoint.timeline = head;
  checkpoint.permissions = permissionHead;
  if (Buffer.byteLength(JSON.stringify(checkpoint)) > MAX_SUMMARY_BYTES)
    throw new Error("Session authorship metadata exceeds byte limit");
  await timeline.owner.writeSummary(checkpoint);
  return result(checkpoint);
}
function result(checkpoint: SummaryCheckpoint): DurableSessionSummary {
  return {
    summary: { ...checkpoint.summary, authorshipStatus: "ready" },
    watermark: createHash("sha256")
      .update(JSON.stringify([checkpoint.timeline, checkpoint.permissions]))
      .digest("hex"),
  };
}

export type SummaryRecoveryInspection =
  | { state: "empty" }
  | { state: "ready"; value: DurableSessionSummary }
  | { state: "replay" }
  | { state: "rebuild" };

interface ProbeIndex {
  epoch: string;
  operationOrder: number;
  revision: number;
  pointers: Record<string, { offset: number; length: number }>;
  summary?: unknown;
}
function probeCursor(index: ProbeIndex, kind: string): SourceCursor {
  let maxSeq = 0;
  for (const key of Object.keys(index.pointers))
    if (key.startsWith(`${kind}:`)) maxSeq = Math.max(maxSeq, Number(key.slice(kind.length + 1)));
  return { epoch: index.epoch, maxSeq, revision: index.revision };
}

/**
 * Readiness probe. No log owner, payload read, directory creation, or index repair is allowed:
 * a missing or unreadable index means the caller must rebuild later, not now.
 */
export async function inspectSummaryRecovery(
  directory: string,
): Promise<SummaryRecoveryInspection> {
  const file = path.join(directory, "events.index.json");
  let index: ProbeIndex;
  try {
    if ((await fs.stat(file)).size > SESSION_STORAGE_LIMITS.readPageBytes)
      return { state: "rebuild" };
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as ProbeIndex;
    if (
      typeof parsed?.epoch !== "string" ||
      !parsed.pointers ||
      typeof parsed.revision !== "number"
    )
      return { state: "rebuild" };
    index = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { state: "rebuild" };
    // No index at all: only a session that also has no log is genuinely empty.
    return (await fs.stat(path.join(directory, "events.jsonl")).catch(() => null))
      ? { state: "rebuild" }
      : { state: "empty" };
  }
  if (!index.operationOrder) return { state: "empty" };
  const timeline = probeCursor(index, "timeline");
  const permissions = probeCursor(index, "permission");
  const checkpoint = parseCheckpoint(index.summary);
  if (
    checkpoint &&
    sameCursor(checkpoint.timeline, timeline) &&
    sameCursor(checkpoint.permissions, permissions)
  )
    return { state: "ready", value: result(checkpoint) };
  // Large rebuilds belong to an explicit history read, not the daemon readiness barrier.
  for (const [head, saved] of [
    [timeline, checkpoint?.timeline],
    [permissions, checkpoint?.permissions],
  ] as const) {
    if (!saved || requiresRebuild(saved, head) || head.maxSeq - saved.maxSeq > 256)
      return { state: "rebuild" };
  }
  return { state: "replay" };
}
