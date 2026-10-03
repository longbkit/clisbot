export class HubRequestBudget {
  private active = 0;
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 64) throw new Error("Hub request capacity reached");
    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
    }
  }
}

export async function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => rejectAbort(signal.reason ?? new Error("Hub request cancelled"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function boundedResponse(response: Response, signal: AbortSignal): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const result = await untilAborted(reader.read(), signal);
      signal.throwIfAborted();
      if (result.done) return Buffer.concat(chunks);
      size += result.value.length;
      if (size > 4 * 1024 * 1024) throw new Error("Hub response too large");
      chunks.push(result.value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}
