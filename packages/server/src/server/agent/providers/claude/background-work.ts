import type { AgentBackgroundWorkInput } from "../../background-work/index.js";
import { CLAUDE_SUBAGENT_TASK_TYPE, CLAUDE_WORKFLOW_TASK_TYPE } from "./subagents/live-source.js";

/**
 * Work a Claude Code process can keep between turns: background tasks (shells, monitors,
 * background subagents) and session crons (CronCreate, ScheduleWakeup, /loop). All of it dies with
 * the process, so a session holding any of it must not be released.
 *
 * Verified on the wire (Claude Code 2.1.302):
 * - `system/background_tasks_changed` lists every live background task and replaces the previous
 *   list. A process starts with none, and the list empties when the work ends.
 * - Crons appear nowhere in the stream. The Stop hook input is the only place they show up, as
 *   `session_crons`, next to `background_tasks`.
 *
 * Crons are read once per turn, so the state is only trusted when the Stop hook ran after the
 * latest turn started. A turn that ends without one (interrupted, failed) leaves it stale, and a
 * stale state never certifies idle. A process that has not run a turn yet holds only what it
 * restored from disk, which this tracker cannot see.
 */
export class ClaudeBackgroundWork {
  private backgroundTaskIds = new Set<string>();
  private sessionCronCount = 0;
  private turnStarted = false;
  private snapshotFresh = false;

  /** A turn began in the current process; its Stop hook will report what it left behind. */
  observeTurnStarted(): void {
    this.turnStarted = true;
    this.snapshotFresh = false;
  }

  observeMessage(message: unknown): void {
    const record = toRecord(message);
    if (record?.type !== "system" || record.subtype !== "background_tasks_changed") return;
    if (!Array.isArray(record.tasks)) return;
    this.backgroundTaskIds = new Set(
      record.tasks.flatMap((task) => {
        const id = readString(toRecord(task)?.task_id);
        return id ? [id] : [];
      }),
    );
  }

  observeStopHook(input: unknown): void {
    const record = toRecord(input);
    if (
      !record ||
      !Array.isArray(record.background_tasks) ||
      !Array.isArray(record.session_crons)
    ) {
      return;
    }
    this.backgroundTaskIds = new Set(
      record.background_tasks.flatMap((task) => {
        const entry = toRecord(task);
        const id = readString(entry?.id);
        return id && isLiveTaskStatus(entry?.status) ? [id] : [];
      }),
    );
    this.sessionCronCount = record.session_crons.length;
    this.snapshotFresh = true;
  }

  get isIdle(): boolean {
    if (this.backgroundTaskIds.size > 0) return false;
    if (!this.turnStarted) return true;
    return this.snapshotFresh && this.sessionCronCount === 0;
  }

  /** The process is gone or about to be replaced; a fresh one starts with nothing. */
  reset(): void {
    this.backgroundTaskIds = new Set();
    this.sessionCronCount = 0;
    this.turnStarted = false;
    this.snapshotFresh = false;
  }
}

function isLiveTaskStatus(status: unknown): boolean {
  return status === undefined || status === "running" || status === "pending";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export interface ClaudeBackgroundTask {
  task_id: string;
  task_type: string;
  /** The user's `claude` binary can differ from the SDK typings, so this is read defensively. */
  description?: unknown;
}

/** Subagents and workflows already live in the subagents track. */
const SUBAGENT_TASK_TYPES = new Set([CLAUDE_SUBAGENT_TASK_TYPE, CLAUDE_WORKFLOW_TASK_TYPE]);

/** Maps `background_tasks_changed.tasks` to provider-agnostic background work. */
export function toBackgroundWorkInputs(
  tasks: readonly ClaudeBackgroundTask[],
): AgentBackgroundWorkInput[] {
  return tasks
    .filter((task) => !SUBAGENT_TASK_TYPES.has(task.task_type))
    .map((task) => ({
      id: task.task_id,
      kind: toKind(task.task_type),
      canStop: task.task_type === "local_bash",
      description: readDescription(task.description),
    }));
}

/** The inventory owner refines shell entries when launch metadata identifies a monitor. */
function toKind(taskType: string): string {
  if (taskType === "local_bash") return "shell";
  return "other";
}

function readDescription(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
