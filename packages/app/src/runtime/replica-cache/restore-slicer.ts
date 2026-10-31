/**
 * Rows of a cached directory parsed per synchronous chunk. One agent row costs about 10 µs to
 * parse in Node and roughly ten times that on Hermes, so a chunk stays near 10–20 ms on a phone.
 */
export const RESTORE_ROWS_PER_CHUNK = 100;

export interface RestoreChunk {
  durationMs: number;
  rows: number;
}

export interface RestoreSlicerDeps {
  now: () => number;
  /** Resolves in a later macrotask, after network answers and a frame had their turn. */
  yieldToEventLoop: () => Promise<void>;
  onChunk: (chunk: RestoreChunk) => void;
  rowsPerChunk?: number;
}

/**
 * Splits the startup cache restore into short synchronous chunks with a macrotask between them,
 * so the Hub and Host answers that arrive meanwhile are not held behind it
 * (docs/features/offline/connection-resilience.md#cold-start-js-thread).
 */
export class RestoreSlicer {
  private readonly rowsPerChunk: number;
  private chunkStartedAt: number | null = null;
  private chunkRows = 0;

  constructor(private readonly deps: RestoreSlicerDeps) {
    this.rowsPerChunk = deps.rowsPerChunk ?? RESTORE_ROWS_PER_CHUNK;
  }

  /** Counts one parsed row; true when the chunk is full and the caller should `pause`. */
  countRow(): boolean {
    this.begin();
    this.chunkRows += 1;
    return this.chunkRows >= this.rowsPerChunk;
  }

  /** Ends the running chunk and lets other work run before the next one starts. */
  async pause(): Promise<void> {
    this.end();
    await this.deps.yieldToEventLoop();
  }

  /** Ends the running chunk, if one is open, without yielding. */
  end(): void {
    if (this.chunkStartedAt === null) return;
    this.deps.onChunk({ durationMs: this.deps.now() - this.chunkStartedAt, rows: this.chunkRows });
    this.chunkStartedAt = null;
    this.chunkRows = 0;
  }

  /** Starts timing a chunk; work that parses no rows (a store commit) still counts as one. */
  begin(): void {
    this.chunkStartedAt ??= this.deps.now();
  }
}

/** A macrotask: `setTimeout(0)` lets queued native messages (network, frames) run first. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
