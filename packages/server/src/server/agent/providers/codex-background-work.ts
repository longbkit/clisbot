/**
 * Work a Codex app-server process can keep between turns, read from its notification stream.
 *
 * Verified on the wire (codex-cli 0.157.1): a shell command the model leaves running is a
 * `commandExecution` item whose `item/started` lands inside the turn and whose `item/completed`
 * lands whenever the process exits, which can be long after `turn/completed`. Older binaries
 * report the same command as `codex/event/exec_command_begin` / `exec_command_end` keyed by
 * `call_id`. An active goal (`thread/goal/updated`) starts turns on its own, and a subagent
 * thread can keep running (`thread/status/changed` → `active`) after the root turn completed.
 *
 * Every thread served by the process counts, including subagent threads: they all die with it.
 * The state is per process — a fresh app-server holds nothing, so callers reset on spawn.
 */
export class CodexBackgroundWork {
  private readonly runningCommandIds = new Set<string>();
  private readonly activeGoalThreadIds = new Set<string>();
  private readonly activeThreadIds = new Set<string>();

  observe(method: string, params: unknown): void {
    const record = toRecord(params);
    if (!record) return;
    switch (method) {
      case "item/started":
        this.observeCommandItem(toRecord(record.item), true);
        return;
      case "item/completed":
        this.observeCommandItem(toRecord(record.item), false);
        return;
      case "codex/event/exec_command_begin":
        this.observeLegacyCommand(toRecord(record.msg), true);
        return;
      case "codex/event/exec_command_end":
        this.observeLegacyCommand(toRecord(record.msg), false);
        return;
      case "thread/goal/updated":
        this.observeGoal(readString(record.threadId), toRecord(record.goal)?.status === "active");
        return;
      case "thread/goal/cleared":
        this.observeGoal(readString(record.threadId), false);
        return;
      case "thread/status/changed":
        this.observeThreadStatus(readString(record.threadId), toRecord(record.status)?.type);
        return;
      case "thread/closed":
        this.observeThreadStatus(readString(record.threadId), "closed");
        this.observeGoal(readString(record.threadId), false);
        return;
      default:
        return;
    }
  }

  /** Records a goal status change Clisbot itself requested, ahead of Codex's notification. */
  observeGoalStatus(threadId: string, status: string | null): void {
    this.observeGoal(threadId, status === "active");
  }

  get isIdle(): boolean {
    return (
      this.runningCommandIds.size === 0 &&
      this.activeGoalThreadIds.size === 0 &&
      this.activeThreadIds.size === 0
    );
  }

  reset(): void {
    this.runningCommandIds.clear();
    this.activeGoalThreadIds.clear();
    this.activeThreadIds.clear();
  }

  private observeCommandItem(item: Record<string, unknown> | null, started: boolean): void {
    const id = readString(item?.id);
    if (!id || item?.type !== "commandExecution") return;
    const running = item.status === undefined || item.status === "inProgress";
    this.track(`item:${id}`, started && running);
  }

  private observeLegacyCommand(message: Record<string, unknown> | null, started: boolean): void {
    const callId = readString(message?.call_id);
    if (callId) this.track(`call:${callId}`, started);
  }

  private observeGoal(threadId: string | undefined, active: boolean): void {
    if (!threadId) return;
    if (active) this.activeGoalThreadIds.add(threadId);
    else this.activeGoalThreadIds.delete(threadId);
  }

  private observeThreadStatus(threadId: string | undefined, status: unknown): void {
    if (!threadId) return;
    if (status === "active") this.activeThreadIds.add(threadId);
    else this.activeThreadIds.delete(threadId);
  }

  private track(id: string, running: boolean): void {
    if (running) this.runningCommandIds.add(id);
    else this.runningCommandIds.delete(id);
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
