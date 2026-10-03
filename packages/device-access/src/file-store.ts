import { mkdir, readFile, open, rename, unlink, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import {
  createAuthorityState,
  assertAuthorityState,
  type DeviceAuthorityState,
  type DeviceAuthorityStore,
} from "./state.js";

export class FileDeviceAuthorityStore implements DeviceAuthorityStore {
  constructor(
    private readonly path: string,
    private readonly backendId: string,
  ) {}

  async transaction<T>(action: (state: DeviceAuthorityState) => T): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.path, {
      realpath: false,
      stale: 15_000,
      update: 5_000,
      retries: { retries: 40, factor: 1, minTimeout: 25, maxTimeout: 25 },
    });
    try {
      const state = await this.read();
      const before = JSON.stringify(state);
      const result = action(state);
      const after = JSON.stringify(state);
      if (after !== before) await this.write(after);
      return result;
    } finally {
      await release();
    }
  }

  private async read(): Promise<DeviceAuthorityState> {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8")) as DeviceAuthorityState;
      assertAuthorityState(state);
      if (state.backendId !== this.backendId) throw new Error("Invalid device authority state");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Persist identity even if the first transaction is read-only.
      const state = createAuthorityState(this.backendId);
      await this.write(JSON.stringify(state));
      return state;
    }
  }

  private async write(value: string): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(value);
        await file.sync();
      } finally {
        await file.close();
      }
      await chmod(temporary, 0o600);
      await rename(temporary, this.path);
      if (process.platform !== "win32") {
        const directory = await open(dirname(this.path), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}
