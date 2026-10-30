import { z } from "zod";
import type { PersistStorage, StateStorage, StorageValue } from "zustand/middleware";

export interface ValidatedPersistStorageOptions {
  // Opt in only when callers preserve state references until values change.
  skipUnchanged?: boolean;
  /**
   * Runs the write later instead of in the caller's task. Validation and serialization of a large
   * state then stay off the interaction that changed it, and changes in between write once, with
   * the latest state. A read writes a scheduled state first.
   */
  writeAfter?: (flush: () => void) => void;
}

interface ScheduledWrite<State> {
  value: StorageValue<State>;
  waiting: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
}

export function createValidatedPersistStorage<State>(
  backingStorage: StateStorage,
  stateSchema: z.ZodType<State>,
  options: ValidatedPersistStorageOptions = {},
): PersistStorage<State> {
  const envelopeSchema = z.strictObject({
    state: stateSchema,
    version: z.number().int().nonnegative().optional(),
  });

  const accepted = new Map<string, StorageValue<State>>();
  const reading = new Set<string>();
  const scheduled = new Map<string, ScheduledWrite<State>>();

  async function read(name: string): Promise<StorageValue<State> | null> {
    const raw = await backingStorage.getItem(name);
    if (raw === null) return null;

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      await backingStorage.removeItem(name);
      return null;
    }

    const result = envelopeSchema.safeParse(decoded);
    if (!result.success) {
      await backingStorage.removeItem(name);
      return null;
    }
    return result.data;
  }

  async function write(name: string, value: StorageValue<State>): Promise<void> {
    const previous = accepted.get(name);
    if (
      options.skipUnchanged &&
      previous &&
      previous.state === value.state &&
      previous.version === value.version
    )
      return;
    const result = envelopeSchema.safeParse(value);
    if (!result.success) {
      accepted.delete(name);
      await backingStorage.removeItem(name);
      return;
    }
    if (options.skipUnchanged) accepted.set(name, value);
    try {
      await backingStorage.setItem(name, JSON.stringify(result.data));
    } catch (error) {
      if (accepted.get(name) === value) accepted.delete(name);
      throw error;
    }
  }

  function flushScheduled(name: string): Promise<void> {
    const pending = scheduled.get(name);
    if (!pending) return Promise.resolve();
    scheduled.delete(name);
    const written = write(name, pending.value);
    written.then(
      () => pending.waiting.forEach((waiter) => waiter.resolve()),
      (error: unknown) => pending.waiting.forEach((waiter) => waiter.reject(error)),
    );
    return written;
  }

  function scheduleWrite(
    name: string,
    value: StorageValue<State>,
    writeAfter: (flush: () => void) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const pending = scheduled.get(name);
      if (pending) {
        pending.value = value;
        pending.waiting.push({ resolve, reject });
        return;
      }
      scheduled.set(name, { value, waiting: [{ resolve, reject }] });
      writeAfter(() => void flushScheduled(name).catch(() => undefined));
    });
  }

  return {
    getItem: async (name) => {
      // Taken before the scheduled write's turn: a change during the read is not written.
      const written = scheduled.has(name) ? flushScheduled(name) : null;
      accepted.delete(name);
      reading.add(name);
      try {
        // A failed write already reached its own callers; the read proceeds either way. Without
        // a scheduled write the read starts in this task, as hydration expects.
        if (written) await written.catch(() => undefined);
        return await read(name);
      } finally {
        reading.delete(name);
      }
    },
    setItem: async (name, value) => {
      // A store that changes before hydration settles writes the defaults it started with.
      // Hydration then merges the stored state in memory without writing it back, so that
      // write would replace the stored state until the next change.
      if (reading.has(name)) return;
      if (options.writeAfter) return scheduleWrite(name, value, options.writeAfter);
      return write(name, value);
    },
    removeItem: (name) => {
      // Removal supersedes a scheduled write: its callers see it settle without writing.
      scheduled.get(name)?.waiting.forEach((waiter) => waiter.resolve());
      scheduled.delete(name);
      accepted.delete(name);
      return backingStorage.removeItem(name);
    },
  };
}
